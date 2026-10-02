/**
 * The shell: a window against the engine's URL, which the dev runner has
 * already started. No preload and no Node in the renderer — the window is an
 * HTTP client like the phone, and the data stays in the engine.
 */
const { app, BrowserWindow, shell } = require("electron");

// The dev runner passes the URL; the installed app (scripts/install-desktop.sh) uses the engine's fixed port.
const URL = process.env.PULSO_DESKTOP_URL || "http://127.0.0.1:3230";
const fromRunner = Boolean(process.env.PULSO_DESKTOP_URL);

app.setName("Pulso");

if (!app.requestSingleInstanceLock()) app.quit();

/** @type {BrowserWindow | null} */
let win = null;

function createWindow() {
  const mac = process.platform === "darwin";
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    // Wide enough that the window always gets the sidebar layout, never the phone's tab bar (md = 768px).
    minWidth: 800,
    minHeight: 560,
    title: "Pulso",
    /* macOS's own material behind the page. It shows only where the page paints
       alpha: the sidebar, when Ajustes › Ventana translúcida is on (the copied
       Telar CSS gates that on `data-telar-shell`, which the page sets inside
       this window). Content stays opaque. Transparent background so the
       material is not painted over; elsewhere, the dark canvas. */
    ...(mac ? { vibrancy: "sidebar", visualEffectState: "active", backgroundColor: "#00000000" } : { backgroundColor: "#0a0a0a" }),
    titleBarStyle: mac ? "hiddenInset" : "default",
    // Centred in the web app's 48px header (--titlebar-height in globals.css): 18 + 12/2 = 24.
    ...(mac ? { trafficLightPosition: { x: 18, y: 18 } } : {}),
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => (win = null));

  // Links leaving the engine open in the system browser, never inside the shell.
  const origin = new globalThis.URL(URL).origin;
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (new globalThis.URL(url).origin !== origin) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // The engine down (restarting, or its disk unplugged): a quiet local page that
  // retries with backoff, instead of a renderer hammering a dead server.
  let retry = 0;
  win.webContents.on("did-fail-load", (_event, _code, _description, failedUrl, isMainFrame) => {
    if (!isMainFrame || !win || failedUrl.startsWith("data:")) return;
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OFFLINE)}`);
    const delay = Math.min(30_000, 2_000 * 2 ** retry++);
    setTimeout(() => win?.loadURL(URL), delay);
  });
  win.webContents.on("did-finish-load", () => {
    if (!win?.webContents.getURL().startsWith("data:")) retry = 0;
  });

  win.loadURL(URL);
}

const OFFLINE = `<!doctype html><html lang="es"><meta name="color-scheme" content="dark light"><body style="margin:0;height:100vh;display:grid;place-items:center;font:15px -apple-system,system-ui;color:#9a9aa0;background:transparent;-webkit-app-region:drag"><div style="text-align:center"><p style="font-size:17px;color:inherit;margin:0 0 6px;font-weight:600">Esperando a Pulso…</p><p style="margin:0">El motor no responde. Se reconecta solo.</p></div></body></html>`;

app.on("second-instance", () => {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(createWindow);
app.on("activate", () => {
  if (!win) createWindow();
});
app.on("window-all-closed", () => app.quit());

// Quit with the runner: if it is killed, nothing would stop this process otherwise.
// The installed app has no runner (its parent is launchd), so this is runner-only.
const parent = process.ppid;
if (fromRunner) setInterval(() => {
  try {
    process.kill(parent, 0);
  } catch {
    app.quit();
  }
}, 2000).unref();
