/**
 * Starts the engine, waits until it answers, then opens Electron against it.
 * Electron quitting stops the engine; this runner dying stops both.
 *
 *   bun run dev            engine + desktop window
 *   bun run dev -- --web   engine only, look at it in a browser
 *
 * The port is fixed (3230, set in apps/engine's dev script) and never hops: a
 * silently different port is how the window ends up on one server and the browser on another.
 */
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repoDir = path.resolve(__dirname, "..", "..");
const HOST = "127.0.0.1";
const PORT = 3230;
const webOnly = process.argv.includes("--web");

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let stopping = false;

/**
 * macOS names the app menu after the bundle's CFBundleName, not app.setName(),
 * so the stock Electron.app shows "Electron" in the menu bar. A renamed copy,
 * made once per Electron version in the temp dir, shows "Pulso". Anything
 * failing falls back to the stock binary: a wrong name beats no window.
 */
function electronBinary() {
  const stock = require("electron");
  if (process.platform !== "darwin") return stock;
  try {
    const source = path.resolve(stock, "../../..");
    const version = require("electron/package.json").version;
    const bundle = path.join(os.tmpdir(), `pulso-dev-electron-${version}`, "Pulso.app");
    const binary = path.join(bundle, "Contents", "MacOS", "Electron");
    if (!fs.existsSync(binary)) {
      fs.rmSync(path.dirname(bundle), { recursive: true, force: true });
      fs.mkdirSync(path.dirname(bundle), { recursive: true });
      execFileSync("ditto", [source, bundle]);
      const plist = path.join(bundle, "Contents", "Info.plist");
      execFileSync("plutil", ["-replace", "CFBundleName", "-string", "Pulso", plist]);
      execFileSync("plutil", ["-replace", "CFBundleDisplayName", "-string", "Pulso", plist]);
      // Edited bundle: re-sign ad hoc so macOS runs it.
      execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "ignore" });
    }
    return binary;
  } catch (error) {
    console.warn(`Using the stock Electron (${error.message}); the menu bar will say "Electron".`);
    return stock;
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, HOST, () => server.close(() => resolve(true)));
  });
}

async function waitForHealth(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopping) throw new Error("stopped while waiting for the engine");
    try {
      const response = await fetch(`http://${HOST}:${PORT}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`the engine did not answer within ${timeoutMs / 1000}s`);
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    // Negative pid: the whole group, so Next's own workers go too.
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  setTimeout(() => process.exit(code), 500);
}

async function main() {
  if (!(await portFree(PORT))) {
    console.error(`Port ${PORT} is taken (another Pulso running?).`);
    process.exit(1);
  }

  const engine = spawn("bun", ["run", "--cwd", "apps/engine", "dev"], {
    cwd: repoDir,
    stdio: "inherit",
    detached: true,
  });
  children.push(engine);
  engine.on("exit", (code) => {
    if (!stopping) {
      console.error(`engine exited (${code})`);
      stop(code ?? 1);
    }
  });

  await waitForHealth();
  const url = `http://${HOST}:${PORT}`;
  console.log(`Pulso engine: ${url}`);
  if (webOnly) return;

  const electron = spawn(electronBinary(), [__dirname], {
    stdio: "inherit",
    detached: true,
    env: { ...process.env, PULSO_DESKTOP_URL: url },
  });
  children.push(electron);
  electron.on("exit", () => stop(0));
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => stop(0));

main().catch((error) => {
  console.error(error.message);
  stop(1);
});
