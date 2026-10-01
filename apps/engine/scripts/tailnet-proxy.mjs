/**
 * Pulso on the tailnet: an HTTP forward bound ONLY to the Tailscale interface,
 * never 0.0.0.0, so physical interfaces stay closed. Same shape as Delta's.
 *
 * HTTP rather than a TCP pipe so every forwarded request can be stamped with
 * `x-pulso-via: tailnet` (and any client-sent copy stripped), plus the Host the
 * browser wrote as `x-pulso-host`. `proxy.ts` uses them to tell tailnet traffic
 * from loopback: loopback is trusted, the tailnet reaches pairing, the
 * bearer-checked phone routes and — for a paired browser — the web app.
 */
import { createServer, request as httpRequest } from "node:http";
import { forwardHeaders } from "./tailnet-headers.mjs";
import { tailnetIp } from "./tailnet-ip.mjs";

const TARGET_PORT = Number(process.env.PULSO_PORT ?? 3230);
const LISTEN_PORT = Number(process.env.PULSO_TAILNET_PORT ?? 8090);

const host = tailnetIp();
if (!host) {
  console.error("No tailnet IP (is Tailscale running?). Exposing nothing.");
  process.exit(1);
}

const server = createServer((from, to) => {
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
});

server.on("error", (error) => {
  console.error(`Could not listen on ${host}:${LISTEN_PORT} — ${error.message}`);
  process.exit(1);
});

server.listen(LISTEN_PORT, host, () => {
  console.log(`Pulso on the tailnet: http://${host}:${LISTEN_PORT} → 127.0.0.1:${TARGET_PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
