const path = require("node:path");
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, screen, ipcMain, clipboard } = require("electron");
const { loadConfig } = require("./config");
const { EventStore } = require("./store");
const { startServer } = require("./proxy-server");

let tray;
let window;
let server;

// Create a proper PNG-based icon for Windows tray.
// SVG-to-nativeImage renders poorly in the Windows system tray, so we generate a
// small PNG buffer programmatically and use a data: URL instead.
function createTrayPng(size) {
  // Small square rounded-rect with "DS" lettering rendered as pixel data.
  const pngSize = size || 32;
  const pixels = Buffer.alloc(pngSize * pngSize * 4);

  function setPixel(px, py, r, g, b, a) {
    if (px < 0 || px >= pngSize || py < 0 || py >= pngSize) return;
    const i = (py * pngSize + px) * 4;
    const alpha = a / 255;
    pixels[i] = Math.round(r * alpha + pixels[i] * (1 - alpha));
    pixels[i + 1] = Math.round(g * alpha + pixels[i + 1] * (1 - alpha));
    pixels[i + 2] = Math.round(b * alpha + pixels[i + 2] * (1 - alpha));
    pixels[i + 3] = Math.min(255, pixels[i + 3] + a);
  }

  // background: rounded rectangle with gradient
  const r = Math.round(pngSize * 0.22);
  for (let y = 0; y < pngSize; y++) {
    for (let x = 0; x < pngSize; x++) {
      let inside = true;
      if (x < r && y < r && (r - x) ** 2 + (r - y) ** 2 > r * r) inside = false;
      if (x >= pngSize - r && y < r && (x - (pngSize - r)) ** 2 + (r - y) ** 2 > r * r) inside = false;
      if (x < r && y >= pngSize - r && (r - x) ** 2 + (y - (pngSize - r)) ** 2 > r * r) inside = false;
      if (x >= pngSize - r && y >= pngSize - r && (x - (pngSize - r)) ** 2 + (y - (pngSize - r)) ** 2 > r * r) inside = false;
      if (inside) {
        const t = y / (pngSize - 1);
        const red = Math.round(110 + t * 0);
        const green = Math.round(231 - t * 30);
        const blue = Math.round(183 + t * 20);
        setPixel(x, y, red, green, blue, 255);
      }
    }
  }

  // "D" letter (simplified)
  const cx = Math.round(pngSize * 0.35);
  const cy = Math.round(pngSize * 0.30);
  const dh = Math.round(pngSize * 0.38);
  const dw = Math.round(pngSize * 0.26);
  const sw = Math.round(pngSize * 0.08);
  // vertical bar
  for (let y = cy; y < cy + dh; y++)
    for (let x = cx; x < cx + sw; x++)
      setPixel(x, y, 255, 255, 255, 255);
  // top bar
  for (let y = cy; y < cy + sw; y++)
    for (let x = cx; x < cx + dw; x++)
      setPixel(x, y, 255, 255, 255, 255);
  // bottom bar
  for (let y = cy + dh - sw; y < cy + dh; y++)
    for (let x = cx; x < cx + dw; x++)
      setPixel(x, y, 255, 255, 255, 255);
  // right bar
  for (let y = cy + sw; y < cy + dh - sw; y++)
    for (let x = cx + dw - sw; x < cx + dw; x++)
      setPixel(x, y, 255, 255, 255, 255);

  // Simple PNG encoder (minimal but valid)
  function crc32(data) {
    let c = 0xffffffff;
    for (const b of data) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  function pngChunk(type, data) {
    const tb = Buffer.from(type, 'ascii');
    const lb = Buffer.alloc(4); lb.writeUInt32BE(data.length, 0);
    const cs = Buffer.alloc(4); cs.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
    return Buffer.concat([lb, tb, data, cs]);
  }
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(pngSize, 0); ihdr.writeUInt32BE(pngSize, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // Raw image data with filter byte
  const raw = Buffer.alloc((pngSize * 4 + 1) * pngSize);
  for (let y = 0; y < pngSize; y++) {
    raw[y * (pngSize * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (pngSize * 4 + 1) + 1, y * pngSize * 4, (y + 1) * pngSize * 4);
  }
  const zlib = require("zlib");
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

// On-demand tray PNG cache
let trayPngDataUrl = null;
function getTrayPngDataUrl() {
  if (!trayPngDataUrl) trayPngDataUrl = createTrayPng(32);
  return trayPngDataUrl;
}

function nativeIconFromPng() {
  return nativeImage.createFromDataURL(getTrayPngDataUrl());
}

function trayIcon() {
  if (process.platform === "win32") {
    // Windows tray needs a proper PNG/ICO — SVG does not render reliably.
    return nativeIconFromPng().resize({ width: 16, height: 16 });
  }
  // macOS: use a template (monochrome) tray icon that adapts to light/dark menu bar.
  const png = nativeIconFromPng().resize({ width: 18, height: 18 });
  png.setTemplateImage(true);
  return png;
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
    icon: process.platform === "darwin" ? undefined : nativeIconFromPng(),
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
