const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { EventStore } = require("../src/store");
const { runDoctor } = require("../src/doctor");

function tempConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cache-doctor-test-"));
  return {
    port: 17860,
    dataDir: path.join(root, "data"),
    claudeSettingsPath: path.join(root, ".claude", "settings.json"),
    claudeMemDir: path.join(root, ".claude-mem"),
    claudeMemPluginId: "claude-mem@thedotmack",
    deepseekBaseUrl: "https://api.deepseek.com",
    deepseekAnthropicBaseUrl: "https://api.deepseek.com/anthropic",
    deepseekApiKey: "",
  };
}

function writeLargeClaudeMemLog(config) {
  const logDir = path.join(config.claudeMemDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, "claude-mem.log");
  fs.writeFileSync(logPath, "", "utf8");
  fs.truncateSync(logPath, 21 * 1024 * 1024);
}

test("doctor warns when no requests are captured", async () => {
  const config = tempConfig();
  const store = new EventStore(config.dataDir);
  const result = await runDoctor({ store, config });
  assert.equal(result.findings[0].title, "还没开始监控");
});

test("doctor flags low cache hit rate", async () => {
  const config = tempConfig();
  const store = new EventStore(config.dataDir);
  for (let i = 0; i < 2; i += 1) {
    store.append({
      timestamp: new Date(Date.now() - 5000 + i).toISOString(),
      provider: "deepseek",
      pathname: "/anthropic/v1/messages",
      statusCode: 200,
      hasUsage: true,
      inputTokens: 30000,
      outputTokens: 100,
      totalTokens: 30100,
      cacheHitTokens: 27000,
      cacheMissTokens: 3000,
      cacheHitRate: 90,
    });
  }
  for (let i = 0; i < 3; i += 1) {
    store.append({
      timestamp: new Date(Date.now() - 3000 + i).toISOString(),
      provider: "deepseek",
      pathname: "/anthropic/v1/messages",
      statusCode: 200,
      hasUsage: true,
      inputTokens: 30000,
      outputTokens: 100,
      totalTokens: 30100,
      cacheHitTokens: 9000,
      cacheMissTokens: 21000,
      cacheHitRate: 30,
    });
  }
  const result = await runDoctor({ store, config });
  assert.ok(result.findings.some((finding) => finding.title === "缓存命中率偏低"));
});

test("doctor treats new low-cache conversation as warmup", async () => {
  const config = tempConfig();
  const store = new EventStore(config.dataDir);
  for (let i = 0; i < 5; i += 1) {
    store.append({
      timestamp: new Date(Date.now() - 5000 + i).toISOString(),
      provider: "deepseek",
      pathname: "/anthropic/v1/messages",
      statusCode: 200,
      hasUsage: true,
      inputTokens: 20000,
      outputTokens: 100,
      totalTokens: 20100,
      cacheHitTokens: 6000,
      cacheMissTokens: 14000,
      cacheHitRate: 30,
    });
  }

  const result = await runDoctor({ store, config });
  assert.ok(!result.findings.some((finding) => finding.severity === "critical" && finding.title === "缓存命中率偏低"));
});

test("doctor flags a heavy low-cache session even before warmup", async () => {
  const config = tempConfig();
  const store = new EventStore(config.dataDir);
  for (let i = 0; i < 6; i += 1) {
    store.append({
      timestamp: new Date(Date.now() - 5000 + i).toISOString(),
      provider: "deepseek",
      pathname: "/anthropic/v1/messages",
      statusCode: 200,
      hasUsage: true,
      inputTokens: 60000,
      outputTokens: 100,
      totalTokens: 60100,
      cacheHitTokens: 6000,
      cacheMissTokens: 54000,
      cacheHitRate: 10,
    });
  }

  const result = await runDoctor({ store, config });
  assert.ok(result.findings.some((finding) => finding.severity === "critical" && finding.title === "缓存命中率偏低"));
});

test("doctor hides cache hit signal with small sample", async () => {
  const config = tempConfig();
  const store = new EventStore(config.dataDir);
  for (let i = 0; i < 2; i += 1) {
    store.append({
      timestamp: new Date().toISOString(),
      provider: "deepseek",
      pathname: "/anthropic/v1/messages",
      statusCode: 200,
      hasUsage: true,
      inputTokens: 20000,
      outputTokens: 100,
      totalTokens: 20100,
      cacheHitTokens: 6000,
      cacheMissTokens: 14000,
      cacheHitRate: 30,
    });
  }
  const result = await runDoctor({ store, config });
  assert.ok(!result.findings.some((finding) => finding.severity === "critical" && finding.title === "缓存命中率偏低"));
  assert.ok(!result.findings.some((finding) => finding.title.includes("缓存")));
});

test("doctor hides recovered cache hit risk", async () => {
  const config = tempConfig();
  const store = new EventStore(config.dataDir);
  for (let i = 0; i < 5; i += 1) {
    store.append({
      timestamp: new Date(Date.now() - 5000 + i).toISOString(),
      provider: "deepseek",
      pathname: "/anthropic/v1/messages",
      statusCode: 200,
      hasUsage: true,
      inputTokens: 20000,
      outputTokens: 100,
      totalTokens: 20100,
      cacheHitTokens: 6000,
      cacheMissTokens: 14000,
      cacheHitRate: 30,
    });
  }
  store.append({
    timestamp: new Date().toISOString(),
    provider: "deepseek",
    pathname: "/anthropic/v1/messages",
    statusCode: 200,
    hasUsage: true,
    inputTokens: 1000,
    outputTokens: 100,
    totalTokens: 1100,
    cacheHitTokens: 53120,
    cacheMissTokens: 0,
    cacheHitRate: 100,
  });

  const result = await runDoctor({ store, config });
  assert.ok(!result.findings.some((finding) => finding.severity === "critical" && finding.title === "缓存命中率偏低"));
  assert.ok(!result.findings.some((finding) => finding.title === "记忆插件可作为排查项"));
});

test("doctor hides stale cache hit risk", async () => {
  const config = tempConfig();
  const store = new EventStore(config.dataDir);
  for (let i = 0; i < 5; i += 1) {
    store.append({
      timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000 + i).toISOString(),
      provider: "deepseek",
      pathname: "/anthropic/v1/messages",
      statusCode: 200,
      hasUsage: true,
      inputTokens: 20000,
      outputTokens: 100,
      totalTokens: 20100,
      cacheHitTokens: 6000,
      cacheMissTokens: 14000,
      cacheHitRate: 30,
    });
  }

  const result = await runDoctor({ store, config });
  assert.ok(!result.findings.some((finding) => finding.severity === "critical" && finding.title === "缓存命中率偏低"));
  assert.ok(!result.findings.some((finding) => finding.title === "记忆插件可作为排查项"));
});

test("doctor hides recovered request errors", async () => {
  const config = tempConfig();
  const store = new EventStore(config.dataDir);
  store.append({
    timestamp: new Date(Date.now() - 2000).toISOString(),
    provider: "deepseek",
    pathname: "/anthropic/v1/messages",
    statusCode: 401,
    errorCode: "unauthorized",
  });
  store.append({
    timestamp: new Date(Date.now() - 1000).toISOString(),
    provider: "deepseek",
    pathname: "/anthropic/v1/messages",
    statusCode: 200,
    hasUsage: true,
    inputTokens: 1000,
    outputTokens: 100,
    totalTokens: 1100,
    cacheHitTokens: 800,
    cacheMissTokens: 200,
    cacheHitRate: 80,
  });

  const result = await runDoctor({ store, config });
  assert.ok(!result.findings.some((finding) => finding.title === "当前请求连续失败"));
});

test("doctor reports only active consecutive request errors", async () => {
  const config = tempConfig();
  const store = new EventStore(config.dataDir);
  for (let i = 0; i < 2; i += 1) {
    store.append({
      timestamp: new Date(Date.now() + i).toISOString(),
      provider: "deepseek",
      pathname: "/anthropic/v1/messages",
      statusCode: 401,
      errorCode: "unauthorized",
    });
  }

  const result = await runDoctor({ store, config });
  assert.ok(result.findings.some((finding) => finding.title === "当前请求连续失败"));
});

test("doctor ignores large claude-mem logs without token risk", async () => {
  const config = tempConfig();
  const store = new EventStore(config.dataDir);
  writeLargeClaudeMemLog(config);
  for (let i = 0; i < 5; i += 1) {
    store.append({
      timestamp: new Date().toISOString(),
      provider: "deepseek",
      pathname: "/anthropic/v1/messages",
      statusCode: 200,
      hasUsage: true,
      inputTokens: 20000,
      outputTokens: 100,
      totalTokens: 20100,
      cacheHitTokens: 18000,
      cacheMissTokens: 2000,
      cacheHitRate: 90,
    });
  }

  const result = await runDoctor({ store, config });
  assert.ok(!result.findings.some((finding) => finding.title.includes("记忆插件")));
});

test("doctor treats large claude-mem logs as context only with token risk", async () => {
  const config = tempConfig();
  const store = new EventStore(config.dataDir);
  writeLargeClaudeMemLog(config);
  for (let i = 0; i < 2; i += 1) {
    store.append({
      timestamp: new Date(Date.now() - 5000 + i).toISOString(),
      provider: "deepseek",
      pathname: "/anthropic/v1/messages",
      statusCode: 200,
      hasUsage: true,
      inputTokens: 30000,
      outputTokens: 100,
      totalTokens: 30100,
      cacheHitTokens: 27000,
      cacheMissTokens: 3000,
      cacheHitRate: 90,
    });
  }
  for (let i = 0; i < 3; i += 1) {
    store.append({
      timestamp: new Date(Date.now() - 3000 + i).toISOString(),
      provider: "deepseek",
      pathname: "/anthropic/v1/messages",
      statusCode: 200,
      hasUsage: true,
      inputTokens: 30000,
      outputTokens: 100,
      totalTokens: 30100,
      cacheHitTokens: 9000,
      cacheMissTokens: 21000,
      cacheHitRate: 30,
    });
  }

  const result = await runDoctor({ store, config });
  const finding = result.findings.find((item) => item.title === "记忆插件可作为排查项");
  assert.ok(finding);
  assert.deepEqual(finding.repairActions, [
    { id: "cleanup_claude_mem_dry_run", label: "预检查清理", autoRun: true },
    { id: "cleanup_claude_mem_apply", label: "确认清理缓存/日志", confirm: true },
  ]);
});

test("doctor asks confirmation before disabling claude-mem", async () => {
  const config = tempConfig();
  const store = new EventStore(config.dataDir);
  fs.mkdirSync(path.dirname(config.claudeSettingsPath), { recursive: true });
  fs.writeFileSync(
    config.claudeSettingsPath,
    JSON.stringify({ enabledPlugins: { [config.claudeMemPluginId]: true } }),
    "utf8",
  );
  for (let i = 0; i < 2; i += 1) {
    store.append({
      timestamp: new Date(Date.now() - 5000 + i).toISOString(),
      provider: "deepseek",
      pathname: "/anthropic/v1/messages",
      statusCode: 200,
      hasUsage: true,
      inputTokens: 30000,
      outputTokens: 100,
      totalTokens: 30100,
      cacheHitTokens: 27000,
      cacheMissTokens: 3000,
      cacheHitRate: 90,
    });
  }
  for (let i = 0; i < 3; i += 1) {
    store.append({
      timestamp: new Date(Date.now() - 3000 + i).toISOString(),
      provider: "deepseek",
      pathname: "/anthropic/v1/messages",
      statusCode: 200,
      hasUsage: true,
      inputTokens: 30000,
      outputTokens: 100,
      totalTokens: 30100,
      cacheHitTokens: 9000,
      cacheMissTokens: 21000,
      cacheHitRate: 30,
    });
  }

  const result = await runDoctor({ store, config });
  const finding = result.findings.find((item) => item.title === "记忆插件可临时做对照");
  assert.ok(finding);
  assert.deepEqual(finding.repairActions, [
    { id: "disable_claude_mem", label: "临时禁用 claude-mem", confirm: true },
  ]);
});
