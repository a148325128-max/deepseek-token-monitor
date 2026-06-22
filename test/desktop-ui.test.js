const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("desktop window is large enough and clamps tray popover inside the work area", () => {
  const main = read("src/main.js");

  assert.match(main, /process\.platform === "win32" \? 420 : 374/);
  assert.match(main, /process\.platform === "win32" \? 760 : 640/);
  assert.match(main, /screen\.getPrimaryDisplay\(\)\.workArea/);
  assert.match(main, /window\.setPosition\(nextX, nextY, false\)/);
});

test("frameless desktop panel has a drag region without blocking controls", () => {
  const styles = read("src/renderer/styles.css");

  assert.match(styles, /\.topbar\s*\{[\s\S]*-webkit-app-region: drag;/);
  assert.match(styles, /button\s*\{[\s\S]*-webkit-app-region: no-drag;/);
  assert.match(styles, /input\s*\{[\s\S]*-webkit-app-region: no-drag;/);
  assert.match(styles, /\.settings-popover\s*\{[\s\S]*-webkit-app-region: no-drag;/);
});

test("primary monitoring and doctor actions remain visible before configuration", () => {
  const html = read("src/renderer/index.html");
  const renderer = read("src/renderer/renderer.js");

  assert.match(html, /id="close-panel"[^>]*>×<\/button>/);
  assert.match(html, /id="doctor-cta" class="doctor-cta">一键体检<\/button>/);
  assert.match(html, /id="connect-ccswitch-current"[^>]*data-mode="settings"[^>]*>配置 Key 开始监控<\/button>/);
  assert.match(html, /id="import-ccswitch-gui"/);
  assert.doesNotMatch(renderer, /button\.hidden = !canReuseCcSwitch/);
  assert.match(renderer, /button\.dataset\.mode = "settings"/);
  assert.match(renderer, /setSettingsPanelOpen\(true\)/);
  assert.match(renderer, /#settings-panel, #settings-toggle, #connect-ccswitch-current/);
});

test("desktop panel opens only on click and exposes an explicit close action", () => {
  const main = read("src/main.js");
  const preload = read("src/preload.js");
  const renderer = read("src/renderer/renderer.js");

  assert.match(main, /tray\.on\("click", toggleWindow\)/);
  assert.doesNotMatch(main, /mouse-enter|mouse-move|showWindowFromHover/);
  assert.doesNotMatch(main, /setTimeout\(\(\) => \{[\s\S]*showWindow\(\)/);
  assert.match(main, /ipcMain\.handle\("hide-window"/);
  assert.match(preload, /hideWindow: \(\) => ipcRenderer\.invoke\("hide-window"\)/);
  assert.match(renderer, /on\("close-panel", "click", closePanel\)/);
});

test("windows release artifact is named as a setup installer", () => {
  const pkg = JSON.parse(read("package.json"));

  assert.equal(pkg.build.win.target[0].target, "nsis");
  assert.equal(pkg.build.nsis.artifactName, "DeepSeek-Monitor-${version}-win-${arch}-Setup.${ext}");
});

test("desktop opens CC Switch links through a safe preload bridge", () => {
  const main = read("src/main.js");
  const preload = read("src/preload.js");
  const renderer = read("src/renderer/renderer.js");

  assert.match(preload, /contextBridge\.exposeInMainWorld\("deepseekMonitor"/);
  assert.match(preload, /openExternal: \(url\) => ipcRenderer\.invoke\("open-external", url\)/);
  assert.match(preload, /copyText: \(text\) => ipcRenderer\.invoke\("copy-text", text\)/);
  assert.match(preload, /hideWindow: \(\) => ipcRenderer\.invoke\("hide-window"\)/);
  assert.match(main, /ipcMain\.handle\("open-external"/);
  assert.match(main, /"ccswitch:"/);
  assert.match(renderer, /window\.deepseekMonitor/);
  assert.match(renderer, /openCcSwitchImportLink\(payload\.link\)/);
  assert.match(renderer, /importCcSwitch\("gui"\)/);
});

test("windows tray icon uses a colorful non-template image", () => {
  const main = read("src/main.js");

  assert.match(main, /process\.platform === "win32"[\s\S]*nativeIcon\("color"\)/);
  assert.match(main, /icon: process\.platform === "darwin" \? undefined : nativeIcon\("color"\)/);
});
