const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PORT = 17860;

function defaultDataDir() {
  const modern = path.join(os.homedir(), ".deepseek-monitor-assistant");
  const legacy = path.join(os.homedir(), ".deepseek-cache-doctor");
  if (!fs.existsSync(modern) && fs.existsSync(legacy)) return legacy;
  return modern;
}

function getSettingsPath(dataDir) {
  return path.join(dataDir, "settings.json");
}

function readLocalSettings(dataDir) {
  const settingsPath = getSettingsPath(dataDir);
  if (!fs.existsSync(settingsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    return {};
  }
}

function validatePort(port) {
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("端口必须是 1 到 65535 之间的整数");
  }
  return parsed;
}

function saveLocalSettings(config, updates) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const current = readLocalSettings(config.dataDir);
  const next = { ...current };
  if (updates.port !== undefined) next.port = validatePort(updates.port);
  if (updates.balanceApiKey !== undefined) next.balanceApiKey = String(updates.balanceApiKey || "").trim();
  fs.writeFileSync(config.settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function loadConfig(overrides = {}) {
  const dataDir =
    overrides.dataDir ||
    process.env.DEEPSEEK_MONITOR_DATA_DIR ||
    process.env.TOKEN_DOCTOR_DATA_DIR ||
    defaultDataDir();
  const localSettings = readLocalSettings(dataDir);
  const portSource = overrides.port
    ? "override"
    : process.env.DEEPSEEK_MONITOR_PORT || process.env.TOKEN_DOCTOR_PORT
      ? "env"
      : localSettings.port
        ? "settings"
        : "default";

  return {
    port: validatePort(
      overrides.port ||
        process.env.DEEPSEEK_MONITOR_PORT ||
        process.env.TOKEN_DOCTOR_PORT ||
        localSettings.port ||
        DEFAULT_PORT,
    ),
    portSource,
    dataDir,
    settingsPath: getSettingsPath(dataDir),
    localSettings,
    deepseekBaseUrl:
      overrides.deepseekBaseUrl ||
      process.env.DEEPSEEK_BASE_URL ||
      "https://api.deepseek.com",
    deepseekAnthropicBaseUrl:
      overrides.deepseekAnthropicBaseUrl ||
      process.env.DEEPSEEK_ANTHROPIC_BASE_URL ||
      "https://api.deepseek.com/anthropic",
    deepseekApiKey:
      overrides.deepseekApiKey ||
      process.env.DEEPSEEK_API_KEY ||
      "",
    balanceApiKey:
      overrides.balanceApiKey ||
      process.env.DEEPSEEK_BALANCE_API_KEY ||
      localSettings.balanceApiKey ||
      "",
    claudeSettingsPath:
      overrides.claudeSettingsPath ||
      process.env.CLAUDE_SETTINGS_PATH ||
      path.join(os.homedir(), ".claude", "settings.json"),
    claudeMemDir:
      overrides.claudeMemDir ||
      process.env.CLAUDE_MEM_DIR ||
      path.join(os.homedir(), ".claude-mem"),
    claudeMemPluginId:
      overrides.claudeMemPluginId ||
      process.env.CLAUDE_MEM_PLUGIN_ID ||
      "claude-mem@thedotmack",
    ccSwitchDbPath:
      overrides.ccSwitchDbPath ||
      process.env.CCSWITCH_DB_PATH ||
      path.join(os.homedir(), ".cc-switch", "cc-switch.db"),
    ccSwitchBackupDir:
      overrides.ccSwitchBackupDir ||
      process.env.CCSWITCH_BACKUP_DIR ||
      path.join(os.homedir(), ".cc-switch", "backups"),
  };
}

module.exports = {
  DEFAULT_PORT,
  defaultDataDir,
  loadConfig,
  readLocalSettings,
  saveLocalSettings,
  validatePort,
};
