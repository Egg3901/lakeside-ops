"use strict";
const { app, BrowserWindow, Menu, ipcMain, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { origin, sameOrigin } = require("./policy");
// An explicit profile path supports isolated installs and automated smoke tests.
const profilePath = app.commandLine.getSwitchValue("user-data-dir");
if (profilePath) app.setPath("userData", path.resolve(profilePath));
let window, connector;
const setupURL = pathToFileURL(path.join(__dirname, "connect.html")).href;
function connect() {
  connector = new BrowserWindow({ width: 540, height: 480, title: "Connect to Keir", backgroundColor: "#111316", webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  connector.loadURL(setupURL); connector.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  connector.webContents.on("will-navigate", (e, url) => { if (url !== setupURL) e.preventDefault(); });
  connector.on("closed", () => { connector = null; });
}
async function open(value) {
  const base = origin(value);
  const response = await fetch(`${base}/api/portal/config`, { redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("This server does not expose a Keir portal. Check the URL and server version.");
  const config = await response.json();
  const loginOrigins = (config.loginOrigins || []).filter(value => { try { return new URL(value).protocol === "https:" && origin(value) === value; } catch { return false; } });
  const partition = `persist:keir-${crypto.createHash("sha256").update(base).digest("hex").slice(0, 24)}`;
  const profile = session.fromPartition(partition);
  // Commit login/session changes promptly rather than waiting for Chromium's
  // periodic cookie write, including when Windows closes the process abruptly.
  profile.cookies.on("changed", () => { profile.cookies.flushStore().catch(() => console.error("Keir could not persist the login session")); });
  profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  profile.setPermissionCheckHandler(() => false);
  const next = new BrowserWindow({ width: 1200, height: 840, minWidth: 720, minHeight: 520, title: "Keir", backgroundColor: "#111316", webPreferences: { session: profile, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  next.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (const event of ["will-navigate", "will-redirect"]) next.webContents.on(event, (e, url) => { if (!sameOrigin(url, base) && !loginOrigins.some(allowed => sameOrigin(url, allowed))) e.preventDefault(); });
  next.on("page-title-updated", e => { e.preventDefault(); next.setTitle("Keir"); });
  next.loadURL(`${base}/keir/app`);
  if (window) window.close(); window = next; connector?.close();
  next.on("closed", () => { if (window === next) window = null; });
  fs.writeFileSync(path.join(app.getPath("userData"), "server.json"), JSON.stringify({ origin: base }), { mode: 0o600 });
}
app.whenReady().then(async () => {
  ipcMain.handle("connect", async (event, value) => {
    if (event.senderFrame?.url !== setupURL || event.sender !== connector?.webContents) throw new Error("Untrusted caller");
    try { await open(value); return { ok: true }; } catch (e) { return { error: e.message }; }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Keir", submenu: [{ label: "Connect to another server", click: connect }, { role: "quit" }] },
    { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
  ]));
  try { await open(JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "server.json"))).origin); } catch { connect(); }
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) connect(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
