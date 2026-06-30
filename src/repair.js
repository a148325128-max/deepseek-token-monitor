const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function exists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sizeOf(targetPath) {
  if (!exists(targetPath)) return 0;
  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  return fs.readdirSync(targetPath).reduce((sum, name) => sum + sizeOf(path.join(targetPath, name)), 0);
}

function countFiles(targetPath) {
  if (!exists(targetPath)) return 0;
  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return 1;
  if (!stat.isDirectory()) return 0;
  return fs.readdirSync(targetPath).reduce((sum, name) => sum + countFiles(path.join(targetPath, name)), 0);
}

function humanBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function getCleanupCandidates(config) {
  const home = os.homedir();
  return [
    path.join(config.claudeMemDir, "cache"),
    path.join(config.claudeMemDir, "logs"),
    path.join(config.claudeMemDir, "tmp"),
    path.join(home, ".cache", "claude-mem"),
    path.join(home, "Library", "Caches", "claude-mem"),
    path.join(home, "Library", "Logs", "claude-mem"),
  ].filter(Boolean);
}

function scanClaudeMem(config) {
  const items = [
    ["database", path.join(config.claudeMemDir, "claude-mem.db")],
    ["database-wal", path.join(config.claudeMemDir, "claude-mem.db-wal")],
    ["chroma", path.join(config.claudeMemDir, "chroma")],
    ["logs", path.join(config.claudeMemDir, "logs")],
    ["backups", path.join(config.claudeMemDir, "backups")],
    ["cache", path.join(config.claudeMemDir, "cache")],
    ["tmp", path.join(config.claudeMemDir, "tmp")],
  ];

  const totalBytes = sizeOf(config.claudeMemDir);
  const rows = items
    .map(([label, targetPath]) => ({
      label,
      path: targetPath,
      exists: exists(targetPath),
      bytes: sizeOf(targetPath),
      humanSize: humanBytes(sizeOf(targetPath)),
      files: countFiles(targetPath),
    }))
    .filter((row) => row.exists || row.bytes > 0);

  const warnings = [];
  const logs = rows.find((row) => row.label === "logs");
  const chroma = rows.find((row) => row.label === "chroma");
  const backups = rows.find((row) => row.label === "backups");
  if (logs && logs.bytes > 20 * 1024 * 1024) warnings.push(`claude-mem 日志偏大: ${logs.humanSize}`);
  if (chroma && chroma.bytes > 500 * 1024 * 1024) warnings.push(`claude-mem 向量库偏大: ${chroma.humanSize}`);
  if (backups && backups.bytes > 100 * 1024 * 1024) warnings.push(`claude-mem 备份偏大: ${backups.humanSize}`);

  return {
    dir: config.claudeMemDir,
    exists: exists(config.claudeMemDir),
    totalBytes,
    humanTotal: humanBytes(totalBytes),
    files: countFiles(config.claudeMemDir),
    rows,
    warnings,
  };
}

function getClaudeMemStatus(config) {
  if (!exists(config.claudeSettingsPath)) {
    return {
      status: "settings_missing",
      settingsPath: config.claudeSettingsPath,
      pluginId: config.claudeMemPluginId,
    };
  }

  try {
    const settings = JSON.parse(fs.readFileSync(config.claudeSettingsPath, "utf8"));
    const value = settings.enabledPlugins?.[config.claudeMemPluginId];
    return {
      status: value === true ? "enabled" : value === false ? "disabled" : "not_configured",
      settingsPath: config.claudeSettingsPath,
      pluginId: config.claudeMemPluginId,
      rawValue: value,
    };
  } catch (error) {
    return {
      status: "settings_invalid",
      settingsPath: config.claudeSettingsPath,
      pluginId: config.claudeMemPluginId,
      error: error.message,
    };
  }
}

function cleanupClaudeMemDryRun(config) {
  return getCleanupCandidates(config)
    .filter((targetPath) => exists(targetPath))
    .map((targetPath) => ({
      path: targetPath,
      bytes: sizeOf(targetPath),
      humanSize: humanBytes(sizeOf(targetPath)),
      files: countFiles(targetPath),
    }));
}

function removeChildren(targetPath) {
  if (!exists(targetPath)) return;
  for (const name of fs.readdirSync(targetPath)) {
    fs.rmSync(path.join(targetPath, name), { recursive: true, force: true });
  }
}

function cleanupClaudeMemApply(config) {
  const candidates = cleanupClaudeMemDryRun(config);
  for (const candidate of candidates) removeChildren(candidate.path);
  return candidates;
}

function setClaudeMemEnabled(config, enabled) {
  if (!exists(config.claudeSettingsPath)) {
    throw new Error(`Claude settings not found: ${config.claudeSettingsPath}`);
  }
  const settings = JSON.parse(fs.readFileSync(config.claudeSettingsPath, "utf8"));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${config.claudeSettingsPath}.bak-deepseek-cache-doctor-${timestamp}`;
  fs.copyFileSync(config.claudeSettingsPath, backupPath);
  settings.enabledPlugins = settings.enabledPlugins || {};
  settings.enabledPlugins[config.claudeMemPluginId] = enabled;
  fs.writeFileSync(config.claudeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return {
    enabled,
    backupPath,
    settingsPath: config.claudeSettingsPath,
    pluginId: config.claudeMemPluginId,
  };
}

async function runRepair(config, action, body = {}) {
  switch (action) {
    case "cleanup_claude_mem_dry_run":
      return { action, mode: "dry-run", candidates: cleanupClaudeMemDryRun(config) };
    case "cleanup_claude_mem_apply":
      if (body.confirm !== true) {
        throw new Error("cleanup_claude_mem_apply requires confirm=true");
      }
      return { action, mode: "apply", removed: cleanupClaudeMemApply(config) };
    case "disable_claude_mem":
      return { action, result: setClaudeMemEnabled(config, false) };
    case "enable_claude_mem":
      return { action, result: setClaudeMemEnabled(config, true) };
    default:
      throw new Error(`Unknown repair action: ${action}`);
  }
}

module.exports = {
  humanBytes,
  scanClaudeMem,
  getClaudeMemStatus,
  cleanupClaudeMemDryRun,
  cleanupClaudeMemApply,
  setClaudeMemEnabled,
  runRepair,
};
