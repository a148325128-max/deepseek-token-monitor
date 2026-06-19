const path = require("node:path");
const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require("electron");
const { loadConfig } = require("./config");
const { EventStore } = require("./store");
const { startServer } = require("./proxy-server");

let tray;
let window;
let server;
let lastHoverShowAt = 0;

function trayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
      <path fill="#000" d="M3.5 2.2h4.7c4.3 0 6.8 2.6 6.8 6.8s-2.5 6.8-6.8 6.8H3.5V2.2Zm3.1 3v7.6h1.5c2.5 0 3.7-1.4 3.7-3.8s-1.2-3.8-3.7-3.8H6.6Z"/>
      <path fill="#000" d="M12.9 2.3c.5-.5 1.3-.1 1.2.6l-.3 1.7 1.6-.3c.7-.1 1.1.7.6 1.2l-2.2 2.2c-.3.3-.8.3-1.1 0l-2-2c-.3-.3-.3-.8 0-1.1l2.2-2.3Z"/>
    </svg>`;
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  image.setTemplateImage(true);
  return image;
}

function createWindow(config) {
  window = new BrowserWindow({
    width: 374,
    height: 540,
    show: false,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    vibrancy: process.platform === "darwin" ? "popover" : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.loadURL(`http://127.0.0.1:${config.port}`);
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl.startsWith("ccswitch://")) {
      event.preventDefault();
      shell.openExternal(targetUrl);
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("ccswitch://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  window.on("blur", () => {
    if (window && window.isVisible()) window.hide();
  });
}

function positionWindow() {
  if (!window || !tray) return;
  const trayBounds = tray.getBounds();
  const windowBounds = window.getBounds();
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  const y =
    process.platform === "darwin"
      ? Math.round(trayBounds.y + trayBounds.height + 8)
      : Math.round(trayBounds.y - windowBounds.height - 8);
  window.setPosition(Math.max(8, x), Math.max(8, y), false);
}

function showWindow() {
  if (!window || !tray) return;
  positionWindow();
  window.show();
  window.focus();
}

function showWindowFromHover() {
  const now = Date.now();
  if (now - lastHoverShowAt < 500) return;
  lastHoverShowAt = now;
  showWindow();
}

function toggleWindow() {
  if (!window || !tray) return;
  if (window.isVisible()) {
    window.hide();
    return;
  }
  showWindow();
}

async function main() {
  app.setName("DeepSeek监控助手");
  app.setAboutPanelOptions({
    applicationName: "DeepSeek监控助手",
    applicationVersion: app.getVersion(),
    copyright: "Claude Code + DeepSeek Token Monitor",
  });
  if (process.platform === "darwin") app.dock.hide();
  const config = loadConfig();
  const store = new EventStore(config.dataDir);
  server = await startServer({ config, store });

  createWindow(config);
  tray = new Tray(trayIcon());
  tray.setToolTip("DeepSeek监控助手");
  if (process.platform === "darwin") tray.setTitle("DS");
  tray.on("click", toggleWindow);
  tray.on("mouse-enter", showWindowFromHover);
  tray.on("mouse-move", showWindowFromHover);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "DeepSeek监控助手", enabled: false },
      { type: "separator" },
      { label: "打开面板", click: toggleWindow },
      {
        label: "打开网页面板",
        click: () => shell.openExternal(`http://127.0.0.1:${config.port}`),
      },
      { type: "separator" },
      { label: "退出", click: () => app.quit() },
    ]),
  );
  setTimeout(() => {
    if (window && !window.isVisible()) showWindow();
  }, 500);
}

app.whenReady().then(main);

app.on("before-quit", () => {
  if (server) server.close();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
