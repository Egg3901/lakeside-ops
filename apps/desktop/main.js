"use strict";
const { app, BrowserWindow, Menu, ipcMain, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { origin, sameOrigin } = require("./policy");
let window, connector;
const setupURL = pathToFileURL(path.join(__dirname, "connect.html")).href;
function connect() {
  connector = new BrowserWindow({ width: 540, height: 480, title: "Connect to Keir", backgroundColor: "#111316", webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  connector.loadURL(setupURL); connector.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  connector.webContents.on("will-navigate", (e, url) => { if (url !== setupURL) e.preventDefault(); });
  connector.on("closed", () => { connector = null; });
}
function open(value) {
  const base = origin(value);
  const partition = `persist:keir-${crypto.createHash("sha256").update(base).digest("hex").slice(0, 24)}`;
  const profile = session.fromPartition(partition);
  profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  profile.setPermissionCheckHandler(() => false);
  const next = new BrowserWindow({ width: 1200, height: 840, minWidth: 720, minHeight: 520, title: "Keir", backgroundColor: "#111316", webPreferences: { session: profile, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  next.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (const event of ["will-navigate", "will-redirect"]) next.webContents.on(event, (e, url) => { if (!sameOrigin(url, base)) e.preventDefault(); });
  next.on("page-title-updated", e => { e.preventDefault(); next.setTitle("Keir"); });
  next.loadURL(base);
  if (window) window.close(); window = next; connector?.close();
  next.on("closed", () => { if (window === next) window = null; });
  fs.writeFileSync(path.join(app.getPath("userData"), "server.json"), JSON.stringify({ origin: base }), { mode: 0o600 });
}
app.whenReady().then(() => {
  ipcMain.handle("connect", (event, value) => {
    if (event.senderFrame?.url !== setupURL || event.sender !== connector?.webContents) throw new Error("Untrusted caller");
    try { open(value); return { ok: true }; } catch (e) { return { error: e.message }; }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Keir", submenu: [{ label: "Connect to another server", click: connect }, { role: "quit" }] },
    { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
  ]));
  try { open(JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "server.json"))).origin); } catch { connect(); }
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) connect(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
