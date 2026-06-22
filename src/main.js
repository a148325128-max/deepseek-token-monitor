const path = require("node:path");
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, screen, ipcMain, clipboard } = require("electron");
const { loadConfig } = require("./config");
const { EventStore } = require("./store");
const { startServer } = require("./proxy-server");

let tray;
let window;
let server;

function iconSvg(color = "template") {
  const fill =
    color === "color"
      ? {
          primary: "#6ee7b7",
          secondary: "#60a5fa",
          foreground: "#ffffff",
        }
      : {
          primary: "#000000",
          secondary: "#000000",
          foreground: "#000000",
        };
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <defs>
        <linearGradient id="bg" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stop-color="${fill.primary}"/>
          <stop offset="1" stop-color="${fill.secondary}"/>
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="26" height="26" rx="9" fill="${color === "color" ? "url(#bg)" : fill.primary}"/>
      <path fill="${fill.foreground}" d="M10.5 8.5h6.2c5.1 0 8.2 3.1 8.2 7.5s-3.1 7.5-8.2 7.5h-6.2v-15Zm4.3 4.1v6.8h1.7c2.5 0 3.8-1.2 3.8-3.4s-1.3-3.4-3.8-3.4h-1.7Z"/>
    </svg>`;
}

function nativeIcon(color = "template") {
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(iconSvg(color)).toString("base64")}`);
}

function trayIcon() {
  if (process.platform === "win32") {
    const image = nativeIcon("color");
    return image.resize({ width: 18, height: 18 });
  }
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
      <path fill="#000" d="M3.5 2.2h4.7c4.3 0 6.8 2.6 6.8 6.8s-2.5 6.8-6.8 6.8H3.5V2.2Zm3.1 3v7.6h1.5c2.5 0 3.7-1.4 3.7-3.8s-1.2-3.8-3.7-3.8H6.6Z"/>
      <path fill="#000" d="M12.9 2.3c.5-.5 1.3-.1 1.2.6l-.3 1.7 1.6-.3c.7-.1 1.1.7.6 1.2l-2.2 2.2c-.3.3-.8.3-1.1 0l-2-2c-.3-.3-.3-.8 0-1.1l2.2-2.3Z"/>
    </svg>`;
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  image.setTemplateImage(true);
  return image;
}

function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(String(url));
    return ["ccswitch:", "http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function registerIpcHandlers() {
  ipcMain.handle("open-external", async (_event, url) => {
    if (!isSafeExternalUrl(url)) {
      throw new Error("不支持打开这个链接");
    }
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle("copy-text", async (_event, text) => {
    clipboard.writeText(String(text || ""));
    return { ok: true };
  });

  ipcMain.handle("hide-window", async () => {
    if (window && window.isVisible()) window.hide();
    return { ok: true };
  });
}

function createWindow(config) {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = process.platform === "win32" ? 420 : 374;
  const preferredHeight = process.platform === "win32" ? 760 : 640;
  const height = Math.max(560, Math.min(preferredHeight, workArea.height - 48));
  window = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    icon: process.platform === "darwin" ? undefined : nativeIcon("color"),
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
  const workArea = screen.getPrimaryDisplay().workArea;
  const trayBounds = tray.getBounds();
  const windowBounds = window.getBounds();
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  const y =
    process.platform === "darwin"
      ? Math.round(trayBounds.y + trayBounds.height + 8)
      : Math.round(trayBounds.y - windowBounds.height - 8);
  const nextX = Math.min(
    Math.max(workArea.x + 8, x),
    workArea.x + workArea.width - windowBounds.width - 8,
  );
  const nextY = Math.min(
    Math.max(workArea.y + 8, y),
    workArea.y + workArea.height - windowBounds.height - 8,
  );
  window.setPosition(nextX, nextY, false);
}

function showWindow() {
  if (!window || !tray) return;
  positionWindow();
  window.show();
  window.focus();
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
  registerIpcHandlers();
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
}

app.whenReady().then(main);

app.on("before-quit", () => {
  if (server) server.close();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
