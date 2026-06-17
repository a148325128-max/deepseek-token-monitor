const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { localClaudeBaseUrl } = require("./claude-config");

function exists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function macAppPath() {
  const candidates = [
    "/Applications/CC Switch.app",
    path.join(os.homedir(), "Applications", "CC Switch.app"),
  ];
  return candidates.find(exists) || null;
}

function windowsAppPath() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "CC Switch", "CC Switch.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "cc-switch", "CC Switch.exe"),
    path.join(process.env.PROGRAMFILES || "", "CC Switch", "CC Switch.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "CC Switch", "CC Switch.exe"),
  ].filter(Boolean);
  return candidates.find(exists) || null;
}

function readMacVersion(appPath) {
  if (!appPath) return null;
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  if (!exists(plistPath)) return null;
  try {
    return execFileSync("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", plistPath], {
      encoding: "utf8",
    }).trim();
  } catch {
    const text = fs.readFileSync(plistPath, "utf8");
    const match = text.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
    return match ? match[1] : null;
  }
}

function getCcSwitchStatus() {
  const base = {
    dbPath: path.join(os.homedir(), ".cc-switch", "cc-switch.db"),
  };
  if (process.platform === "darwin") {
    const appPath = macAppPath();
    return {
      ...base,
      installed: Boolean(appPath),
      appPath,
      version: readMacVersion(appPath),
      protocol: "ccswitch",
    };
  }
  if (process.platform === "win32") {
    const appPath = windowsAppPath();
    return {
      ...base,
      installed: Boolean(appPath || exists(base.dbPath)),
      appPath,
      version: null,
      protocol: "ccswitch",
    };
  }

  return {
    ...base,
    installed: exists(base.dbPath),
    appPath: null,
    version: null,
    protocol: "ccswitch",
  };
}

function findExecutable(command) {
  const pathEnv = process.env.PATH || "";
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")
      : [""];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function sqliteCommand() {
  return findExecutable("sqlite3");
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return sqlQuote(value);
}

function runSqlJson(dbPath, sql) {
  if (!exists(dbPath)) return [];
  const sqlite = sqliteCommand();
  if (!sqlite) return [];
  try {
    const output = execFileSync(sqlite, ["-json", dbPath, sql], { encoding: "utf8" }).trim();
    return output ? JSON.parse(output) : [];
  } catch {
    return [];
  }
}

function runSql(dbPath, sql) {
  const sqlite = sqliteCommand();
  if (!sqlite) {
    throw new Error("没有找到 sqlite3 命令，无法直接克隆 CC Switch Provider；可以改用导入链接或直接配置 Claude Code。");
  }
  execFileSync(sqlite, [dbPath, sql], { encoding: "utf8" });
}

function getTableColumns(dbPath, tableName) {
  return runSqlJson(dbPath, `PRAGMA table_info(${tableName});`).map((column) => column.name);
}

function maskConfig(value) {
  if (Array.isArray(value)) return value.map(maskConfig);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /key|token|secret|password|credential|auth|bearer/i.test(key) ? (item ? "***redacted***" : item) : maskConfig(item),
      ]),
    );
  }
  if (typeof value === "string" && /sk-[A-Za-z0-9_-]{8,}/.test(value)) {
    return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***redacted***");
  }
  return value;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getCurrentClaudeProvider(config) {
  const dbPath = config.ccSwitchDbPath || path.join(os.homedir(), ".cc-switch", "cc-switch.db");
  const rows = runSqlJson(
    dbPath,
    `
      SELECT
        p.id,
        p.app_type as appType,
        p.name,
        p.provider_type as providerType,
        p.settings_config as settingsConfig,
        p.is_current as isCurrent,
        group_concat(e.url, ' | ') as endpoints
      FROM providers p
      LEFT JOIN provider_endpoints e
        ON e.provider_id = p.id AND e.app_type = p.app_type
      WHERE p.app_type = 'claude' AND p.is_current = 1
      GROUP BY p.id, p.app_type
      LIMIT 1;
    `,
  );
  const row = rows[0] || null;
  if (!row) {
    return {
      exists: exists(dbPath),
      dbPath,
      provider: null,
    };
  }

  const settingsConfig = safeJsonParse(row.settingsConfig) || {};
  const env = settingsConfig.env || {};
  const baseUrl = env.ANTHROPIC_BASE_URL || "";
  return {
    exists: true,
    dbPath,
    provider: {
      id: row.id,
      appType: row.appType,
      name: row.name,
      providerType: row.providerType || "",
      endpoints: row.endpoints || "",
      baseUrl,
      model: env.ANTHROPIC_MODEL || "",
      hasAuthToken: Boolean(env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY),
      alreadyProxied: baseUrl === localClaudeBaseUrl(config),
      settingsConfig: maskConfig(settingsConfig),
    },
  };
}

function getCcSwitchUsageSummary(config) {
  const dbPath = config.ccSwitchDbPath || path.join(os.homedir(), ".cc-switch", "cc-switch.db");
  const rows = runSqlJson(
    dbPath,
    `
      SELECT
        app_type as appType,
        provider_id as providerId,
        model,
        SUM(request_count) as requestCount,
        SUM(input_tokens) as inputTokens,
        SUM(output_tokens) as outputTokens,
        SUM(cache_read_tokens) as cacheReadTokens,
        SUM(cache_creation_tokens) as cacheCreationTokens,
        SUM(CAST(total_cost_usd AS REAL)) as totalCostUsd
      FROM usage_daily_rollups
      WHERE app_type = 'claude'
      GROUP BY app_type, provider_id, model
      ORDER BY requestCount DESC
      LIMIT 8;
    `,
  );
  return {
    dbPath,
    rows,
  };
}

function backupFile(sourcePath, backupDir, label) {
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `${label}-${timestamp}${path.extname(sourcePath) || ".bak"}`);
  fs.copyFileSync(sourcePath, backupPath);
  return backupPath;
}

function updateClaudeSettingsBaseUrl(config, backupDir) {
  const settingsPath = config.claudeSettingsPath;
  if (!exists(settingsPath)) return null;
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  settings.env = settings.env || {};
  settings.env.ANTHROPIC_BASE_URL = localClaudeBaseUrl(config);
  const backupPath = backupFile(settingsPath, backupDir, "claude-settings");
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return backupPath;
}

function updateCcSwitchSettingsCurrentProvider(config, backupDir, providerId) {
  const settingsPath = path.join(path.dirname(config.ccSwitchDbPath || path.join(os.homedir(), ".cc-switch", "cc-switch.db")), "settings.json");
  if (!exists(settingsPath)) return null;
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  settings.currentProviderClaude = providerId;
  const backupPath = backupFile(settingsPath, backupDir, "ccswitch-settings");
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return backupPath;
}

function connectCurrentCcSwitchProvider(config) {
  const current = getCurrentClaudeProvider(config);
  const provider = current.provider;
  if (!provider) throw new Error("没有找到 CC Switch 当前 Claude Provider");
  if (!provider.hasAuthToken) throw new Error("当前 CC Switch Provider 没有可复用的 Key 字段");

  const dbPath = config.ccSwitchDbPath || path.join(os.homedir(), ".cc-switch", "cc-switch.db");
  const backupDir = config.ccSwitchBackupDir || path.join(os.homedir(), ".cc-switch", "backups");
  const dbBackupPath = backupFile(dbPath, backupDir, "deepseek-cache-doctor-ccswitch");
  const targetBaseUrl = localClaudeBaseUrl(config);
  const cloneId = `cache-doctor-${provider.id}`;
  const isMonitorProvider = provider.name.includes("缓存医生") || provider.name.includes("监控助手");
  const cloneName = isMonitorProvider ? provider.name : `${provider.name}（监控助手）`;
  const appType = sqlQuote(provider.appType);
  const target = sqlQuote(targetBaseUrl);
  const providerRows = runSqlJson(
    dbPath,
    `SELECT * FROM providers WHERE id = ${sqlQuote(provider.id)} AND app_type = ${appType} LIMIT 1;`,
  );
  const originalRow = providerRows[0];
  if (!originalRow) throw new Error("没有找到 CC Switch 当前 Provider 数据");

  const settingsConfig = safeJsonParse(originalRow.settings_config) || {};
  settingsConfig.env = settingsConfig.env || {};
  settingsConfig.env.ANTHROPIC_BASE_URL = targetBaseUrl;

  const providerColumns = getTableColumns(dbPath, "providers");
  const providerValues = providerColumns.map((column) => {
    if (column === "id") return cloneId;
    if (column === "name") return cloneName;
    if (column === "settings_config") return JSON.stringify(settingsConfig);
    if (column === "is_current") return 1;
    if (column === "created_at") return Date.now();
    if (column === "sort_index") return Number(originalRow.sort_index || 0) + 1;
    if (column === "notes") {
      const note = "由 DeepSeek监控助手创建的监控副本；原 Provider 保留不变。";
      return originalRow.notes ? `${originalRow.notes}\n${note}` : note;
    }
    return originalRow[column];
  });

  const endpointColumns = getTableColumns(dbPath, "provider_endpoints");
  const endpointValues = endpointColumns.map((column) => {
    if (column === "id") return null;
    if (column === "provider_id") return cloneId;
    if (column === "app_type") return provider.appType;
    if (column === "url") return targetBaseUrl;
    if (column === "added_at") return Date.now();
    return null;
  });

  runSql(
    dbPath,
    `
      BEGIN;
      UPDATE providers SET is_current = 0 WHERE app_type = ${appType};
      DELETE FROM providers WHERE id = ${sqlQuote(cloneId)} AND app_type = ${appType};
      INSERT INTO providers (${providerColumns.map((column) => `"${column}"`).join(", ")})
      VALUES (${providerValues.map(sqlValue).join(", ")});
      DELETE FROM provider_endpoints WHERE provider_id = ${sqlQuote(cloneId)} AND app_type = ${appType};
      INSERT INTO provider_endpoints (${endpointColumns.map((column) => `"${column}"`).join(", ")})
      VALUES (${endpointValues.map(sqlValue).join(", ")});
      COMMIT;
    `,
  );

  const claudeSettingsBackupPath = updateClaudeSettingsBaseUrl(config, backupDir);
  const ccSwitchSettingsBackupPath = updateCcSwitchSettingsCurrentProvider(config, backupDir, cloneId);
  return {
    originalProviderId: provider.id,
    originalProviderName: provider.name,
    providerId: cloneId,
    providerName: cloneName,
    targetBaseUrl,
    dbBackupPath,
    claudeSettingsBackupPath,
    ccSwitchSettingsBackupPath,
    provider: getCurrentClaudeProvider(config).provider,
  };
}

function buildCcSwitchProviderLink({ name, endpoint, apiKey, model = "deepseek-chat" }) {
  const params = new URLSearchParams({
    resource: "provider",
    app: "claude",
    name: name || "DeepSeek监控助手",
    endpoint,
    apiKey,
    model,
    haikuModel: model,
    sonnetModel: model,
    opusModel: "deepseek-reasoner",
    notes: "由 DeepSeek监控助手本地生成。导入后在 CC Switch 中确认并切换到该 provider。",
  });
  return `ccswitch://v1/import?${params.toString()}`;
}

module.exports = {
  buildCcSwitchProviderLink,
  connectCurrentCcSwitchProvider,
  getCcSwitchUsageSummary,
  getCurrentClaudeProvider,
  getCcSwitchStatus,
};
