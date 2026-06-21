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

  assert.match(html, /id="doctor-cta" class="doctor-cta">一键体检<\/button>/);
  assert.match(html, /id="connect-ccswitch-current"[^>]*data-mode="settings"[^>]*>配置 Key 开始监控<\/button>/);
  assert.doesNotMatch(renderer, /button\.hidden = !canReuseCcSwitch/);
  assert.match(renderer, /button\.dataset\.mode = "settings"/);
  assert.match(renderer, /setSettingsPanelOpen\(true\)/);
  assert.match(renderer, /#settings-panel, #settings-toggle, #connect-ccswitch-current/);
});

test("windows release artifact is named as a setup installer", () => {
  const pkg = JSON.parse(read("package.json"));

  assert.equal(pkg.build.win.target[0].target, "nsis");
  assert.equal(pkg.build.nsis.artifactName, "DeepSeek-Monitor-${version}-win-${arch}-Setup.${ext}");
});
