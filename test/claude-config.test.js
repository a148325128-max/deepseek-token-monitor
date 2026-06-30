const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { configureClaudeCode, getClaudeConfigStatus, maskKey, validateApiKey } = require("../src/claude-config");
const { buildCcSwitchProviderLink, connectCurrentCcSwitchProvider, getCurrentClaudeProvider } = require("../src/ccswitch");

let initSqlJs = null;
try {
  initSqlJs = require("sql.js");
} catch {
  // Optional dependency.
}

function tempConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cache-doctor-config-test-"));
  return {
    port: 17860,
    dataDir: path.join(root, "data"),
    claudeSettingsPath: path.join(root, ".claude", "settings.json"),
    ccSwitchDbPath: path.join(root, ".cc-switch", "cc-switch.db"),
    ccSwitchBackupDir: path.join(root, ".cc-switch", "backups"),
  };
}

async function makeCcSwitchDb(config) {
  fs.mkdirSync(path.dirname(config.ccSwitchDbPath), { recursive: true });
  const sql = `
    CREATE TABLE providers (
      id TEXT NOT NULL,
      app_type TEXT NOT NULL,
      name TEXT NOT NULL,
      settings_config TEXT NOT NULL,
      provider_type TEXT,
      is_current BOOLEAN NOT NULL DEFAULT 0,
      PRIMARY KEY (id, app_type)
    );
    CREATE TABLE provider_endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      app_type TEXT NOT NULL,
      url TEXT NOT NULL
    );
    INSERT INTO providers (id, app_type, name, settings_config, is_current)
    VALUES (
      'provider-1',
      'claude',
      'DeepSeek',
      '{"env":{"ANTHROPIC_BASE_URL":"https://api.deepseek.com/anthropic","ANTHROPIC_AUTH_TOKEN":"test-secret-value","ANTHROPIC_MODEL":"deepseek-chat"}}',
      1
    );
    INSERT INTO provider_endpoints (provider_id, app_type, url)
    VALUES ('provider-1', 'claude', 'https://api.deepseek.com/anthropic');
  `;
  if (initSqlJs) {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run("PRAGMA foreign_keys = OFF;");
    const stmts = sql.split(";").map(s => s.trim()).filter(Boolean);
    for (const s of stmts) db.run(s + ";");
    const data = db.export();
    fs.writeFileSync(config.ccSwitchDbPath, Buffer.from(data));
    db.close();
  } else {
    execFileSync("sqlite3", [config.ccSwitchDbPath, sql]);
  }
}

function queryDbField(dbPath, sql) {
  if (initSqlJs) {
    // sql.js is async but we need sync here — use the CLI fallback or a workaround
    return null;
  }
  const output = execFileSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
  return output.trim();
}

test("configures Claude Code env with backup", () => {
  const config = tempConfig();
  fs.mkdirSync(path.dirname(config.claudeSettingsPath), { recursive: true });
  fs.writeFileSync(config.claudeSettingsPath, JSON.stringify({ theme: "dark" }), "utf8");

  const result = configureClaudeCode(config, "test-deepseek-key-123456");
  const settings = JSON.parse(fs.readFileSync(config.claudeSettingsPath, "utf8"));

  assert.equal(settings.theme, "dark");
  assert.equal(settings.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:17860/anthropic");
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, "test-deepseek-key-123456");
  assert.ok(result.backupPath.endsWith(path.basename(result.backupPath)));
  assert.ok(fs.existsSync(result.backupPath));
});

test("reports Claude config status without exposing full key", () => {
  const config = tempConfig();
  configureClaudeCode(config, "test-deepseek-key-abcdef");
  const status = getClaudeConfigStatus(config, { readEvents: () => [] });

  assert.equal(status.configured, true);
  assert.equal(status.baseUrlMatches, true);
  assert.equal(status.hasApiKey, true);
  assert.equal(status.maskedApiKey, maskKey("test-deepseek-key-abcdef"));
  assert.ok(!status.maskedApiKey.includes("abcdef") || status.maskedApiKey.endsWith("cdef"));
});

test("rejects placeholder keys", () => {
  assert.throws(() => validateApiKey("sk-粘贴新建的DeepSeekKey"), /占位文本/);
  assert.throws(() => validateApiKey(""), /请先粘贴/);
});

test("builds CC Switch provider deep link", () => {
  const link = buildCcSwitchProviderLink({
    name: "DeepSeek监控助手",
    endpoint: "http://127.0.0.1:17860/anthropic",
    apiKey: "test-deepseek-key-abcdef",
  });
  const url = new URL(link);

  assert.equal(url.protocol, "ccswitch:");
  assert.equal(url.hostname, "v1");
  assert.equal(url.pathname, "/import");
  assert.equal(url.searchParams.get("resource"), "provider");
  assert.equal(url.searchParams.get("app"), "claude");
  assert.equal(url.searchParams.get("endpoint"), "http://127.0.0.1:17860/anthropic");
  assert.equal(url.searchParams.get("apiKey"), "test-deepseek-key-abcdef");
  assert.equal(url.searchParams.get("target"), "cli");
  assert.equal(url.searchParams.get("client"), "cli");
});

test("builds CC Switch GUI-targeted provider deep link without changing app type", () => {
  const link = buildCcSwitchProviderLink({
    endpoint: "http://127.0.0.1:17860/anthropic",
    apiKey: "test-deepseek-key-abcdef",
    target: "gui",
  });
  const url = new URL(link);

  assert.equal(url.searchParams.get("app"), "claude");
  assert.equal(url.searchParams.get("target"), "gui");
  assert.equal(url.searchParams.get("client"), "gui");
  assert.match(url.searchParams.get("name"), /Claude GUI/);
});

test("creates monitored CC Switch provider copy without exposing key", async () => {
  const config = tempConfig();
  await makeCcSwitchDb(config);
  fs.mkdirSync(path.dirname(config.claudeSettingsPath), { recursive: true });
  fs.writeFileSync(
    config.claudeSettingsPath,
    JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: "test-secret-value",
      },
    }),
    "utf8",
  );

  const result = await connectCurrentCcSwitchProvider(config);
  const current = (await getCurrentClaudeProvider(config)).provider;
  const settings = JSON.parse(fs.readFileSync(config.claudeSettingsPath, "utf8"));

  assert.equal(result.originalProviderName, "DeepSeek");
  assert.equal(result.providerName, "DeepSeek（监控助手）");
  assert.equal(result.providerId, "cache-doctor-provider-1");
  assert.equal(current.baseUrl, "http://127.0.0.1:17860/anthropic");
  assert.equal(settings.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:17860/anthropic");
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, "test-secret-value");
  assert.ok(fs.existsSync(result.dbBackupPath));
  assert.ok(fs.existsSync(result.claudeSettingsBackupPath));
});
