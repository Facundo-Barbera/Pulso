/**
 * The shell: a window against the engine's URL, which the dev runner has
 * already started. No preload and no Node in the renderer — the window is an
 * HTTP client like the phone, and the data stays in the engine.
 */
const { app, BrowserWindow, shell } = require("electron");

const URL = process.env.PULSO_DESKTOP_URL;
if (!URL) {
  console.error("PULSO_DESKTOP_URL is not set. Start with `bun run dev` from the repo root.");
  process.exit(1);
}

app.setName("Pulso");

if (!app.requestSingleInstanceLock()) app.quit();

/** @type {BrowserWindow | null} */
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    title: "Pulso",
    backgroundColor: "#0a0a0a",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
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

  win.loadURL(URL);
}

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
const parent = process.ppid;
setInterval(() => {
  try {
    process.kill(parent, 0);
  } catch {
    app.quit();
  }
}, 2000).unref();
