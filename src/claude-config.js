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

function readJsonFile(filePath) {
  if (!exists(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function backupFile(filePath) {
  if (!exists(filePath)) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.bak-deepseek-cache-doctor-${timestamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function localClaudeBaseUrl(config) {
  return `http://127.0.0.1:${config.port}/anthropic`;
}

function maskKey(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 12) return `${text.slice(0, 3)}***`;
  return `${text.slice(0, 7)}***${text.slice(-4)}`;
}

function validateApiKey(value) {
  const key = String(value || "").trim();
  if (!key) throw new Error("请先粘贴新建的 DeepSeek Key");
  if (key.includes("替换") || key.includes("粘贴")) {
    throw new Error("请把占位文本替换成真实 DeepSeek Key");
  }
  if (key.length < 16) throw new Error("DeepSeek Key 看起来太短，请检查是否复制完整");
  return key;
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

function getClaudeConfigStatus(config, store) {
  const status = {
    settingsPath: config.claudeSettingsPath,
    settingsExists: exists(config.claudeSettingsPath),
    settingsValid: true,
    configured: false,
    hasBaseUrl: false,
    hasApiKey: false,
    baseUrlMatches: false,
    expectedBaseUrl: localClaudeBaseUrl(config),
    maskedApiKey: null,
    claudeCommandPath: findExecutable("claude"),
    recentTraffic: false,
    checks: [],
  };

  let settings = {};
  try {
    settings = readJsonFile(config.claudeSettingsPath);
  } catch (error) {
    status.settingsValid = false;
    status.error = error.message;
  }

  const env = settings.env || {};
  const baseUrl = env.ANTHROPIC_BASE_URL || "";
  const apiKey = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || "";
  status.hasBaseUrl = Boolean(baseUrl);
  status.hasApiKey = Boolean(apiKey);
  status.baseUrlMatches = baseUrl === status.expectedBaseUrl;
  status.maskedApiKey = maskKey(apiKey);
  status.configured = status.settingsValid && status.baseUrlMatches && status.hasApiKey;
  status.recentTraffic = Boolean(store?.readEvents({ limit: 1 }).length);

  status.checks = [
    {
      id: "settings",
      ok: status.settingsValid,
      label: status.settingsExists ? "Claude 配置文件可读取" : "将创建 Claude 配置文件",
    },
    {
      id: "base_url",
      ok: status.baseUrlMatches,
      label: status.baseUrlMatches ? "接入地址已指向本工具" : "接入地址还没指向本工具",
    },
    {
      id: "api_key",
      ok: status.hasApiKey,
      label: status.hasApiKey ? "已写入 DeepSeek Key" : "还没有写入 DeepSeek Key",
    },
    {
      id: "claude_binary",
      ok: Boolean(status.claudeCommandPath),
      label: status.claudeCommandPath ? "已找到 claude 命令" : "没有在 PATH 里找到 claude 命令",
    },
    {
      id: "traffic",
      ok: status.recentTraffic,
      label: status.recentTraffic ? "本工具已经收到过请求" : "还没收到 Claude Code 请求",
    },
  ];

  return status;
}

function configureClaudeCode(config, apiKey) {
  const key = validateApiKey(apiKey);
  const settingsPath = config.claudeSettingsPath;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  let settings = {};
  try {
    settings = readJsonFile(settingsPath);
  } catch (error) {
    throw new Error(`Claude 配置文件不是有效 JSON：${error.message}`);
  }

  const backupPath = backupFile(settingsPath);
  settings.env = {
    ...(settings.env || {}),
    ANTHROPIC_BASE_URL: localClaudeBaseUrl(config),
    ANTHROPIC_AUTH_TOKEN: key,
  };

  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(settingsPath, 0o600);
  } catch {
    // chmod is best-effort on non-POSIX filesystems.
  }

  return {
    settingsPath,
    backupPath,
    baseUrl: localClaudeBaseUrl(config),
    maskedApiKey: maskKey(key),
  };
}

module.exports = {
  configureClaudeCode,
  getClaudeConfigStatus,
  localClaudeBaseUrl,
  maskKey,
  validateApiKey,
};
