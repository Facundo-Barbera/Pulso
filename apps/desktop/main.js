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
