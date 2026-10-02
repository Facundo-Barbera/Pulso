/**
 * Pulso on the tailnet: an HTTP forward bound ONLY to the Tailscale interface,
 * never 0.0.0.0, so physical interfaces stay closed. Same shape as Delta's.
 *
 * HTTP rather than a TCP pipe so every forwarded request can be stamped with
 * `x-pulso-via: tailnet` (and any client-sent copy stripped), plus the Host the
 * browser wrote as `x-pulso-host`. `proxy.ts` uses them to tell tailnet traffic
 * from loopback: loopback is trusted, the tailnet reaches pairing, the
 * bearer-checked phone routes and — for a paired browser — the web app.
 *
 * Browsers should use https://<this Mac>.ts.net:8443 instead, like Telar does:
 * `tailscale serve` terminates TLS (a secure context, so randomUUID, clipboard
 * and camera work) and forwards to the loopback listener below, which stamps
 * the same headers. Runs on Node: Bun drops writes to an upgraded socket, and
 * the dev server's `/_next/hmr` WebSocket has to get through.
 */
import { execFile } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { forwardHeaders } from "./tailnet-headers.mjs";
import { tailnetCertDomain, tailnetIp, tailscaleBin } from "./tailnet-ip.mjs";

const TARGET_PORT = Number(process.env.PULSO_PORT ?? 3230);
const LISTEN_PORT = Number(process.env.PULSO_TAILNET_PORT ?? 8090);
const SERVE_PORT = Number(process.env.PULSO_TAILNET_SERVE_PORT ?? 8091);
const HTTPS_PORT = Number(process.env.PULSO_TAILNET_HTTPS_PORT ?? 8443);

const host = tailnetIp();
if (!host) {
  console.error("No tailnet IP (is Tailscale running?). Exposing nothing.");
  process.exit(1);
}

function forward(from, to) {
  const headers = forwardHeaders(from.headers, TARGET_PORT);
  const upstream = httpRequest({ host: "127.0.0.1", port: TARGET_PORT, method: from.method, path: from.url, headers }, (answer) => {
    to.writeHead(answer.statusCode ?? 502, answer.headers);
    answer.pipe(to);
  });
  upstream.on("error", () => {
    if (!to.headersSent) to.writeHead(502, { "content-type": "application/json" });
    to.end(JSON.stringify({ code: "engine_down", message: `Pulso is not answering on 127.0.0.1:${TARGET_PORT}` }));
  });
  from.on("aborted", () => upstream.destroy());
  to.on("close", () => upstream.destroy());
  from.pipe(upstream);
}

/** WebSocket upgrades: the stamped handshake goes up raw, then bytes flow both ways. */
function upgrade(from, socket, head) {
  const headers = forwardHeaders(from.headers, TARGET_PORT);
  const upstream = connect(TARGET_PORT, "127.0.0.1", () => {
    const lines = Object.entries(headers).flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).filter((v) => v !== undefined).map((v) => `${name}: ${v}`));
    upstream.write(`${from.method} ${from.url} HTTP/${from.httpVersion}\r\n${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on("error", close);
  socket.on("error", close);
}

function listen(port, address) {
  const server = createServer(forward);
  server.on("upgrade", upgrade);
  server.on("error", (error) => {
    console.error(`Could not listen on ${address}:${port} — ${error.message}`);
    process.exit(1);
  });
  server.listen(port, address, () => console.log(`Pulso: http://${address}:${port} → 127.0.0.1:${TARGET_PORT}`));
  return server;
}

const servers = [listen(LISTEN_PORT, host), listen(SERVE_PORT, "127.0.0.1")];

// Idempotent and persistent on Tailscale's side; failing here only leaves the http address.
const domain = tailnetCertDomain();
if (domain) {
  execFile(tailscaleBin() ?? "tailscale", ["serve", "--bg", `--https=${HTTPS_PORT}`, `http://127.0.0.1:${SERVE_PORT}`], { timeout: 10_000 }, (error, _out, stderr) => {
    if (error) console.error(`tailscale serve failed; browsers keep the http address. ${String(stderr).trim() || error.message}`);
    else console.log(`Pulso for browsers: https://${domain}:${HTTPS_PORT}`);
  });
} else {
  console.error("No Tailscale HTTPS name (HTTPS certificates off?); browsers keep the http address.");
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))).then(() => process.exit(0)));
