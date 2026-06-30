const { scanClaudeMem, getClaudeMemStatus } = require("./repair");
const { getSystemStatus } = require("./system");

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(1));
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function severityRank(severity) {
  return { critical: 0, warning: 1, info: 2, ok: 3 }[severity] ?? 4;
}

const CACHE_MIN_SAMPLE_COUNT = 5;
const CACHE_MIN_TOKEN_VOLUME = 80000;
const CACHE_MIN_ACTIVE_LOW_COUNT = 3;
const CACHE_ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000;
const CACHE_SESSION_GAP_MS = 30 * 60 * 1000;
const CACHE_HIT_RISK_THRESHOLD = 60;
const CACHE_WARM_HIT_THRESHOLD = 70;
const CACHE_HEAVY_LOW_COUNT = 6;
const CACHE_HEAVY_LOW_TOKEN_VOLUME = 300000;

function cacheTokenVolume(event) {
  const cacheTokens = sum([event.cacheHitTokens, event.cacheMissTokens]);
  return cacheTokens || Number(event.inputTokens) || 0;
}

function isErrorEvent(event) {
  return event.statusCode >= 400 || Boolean(event.errorCode);
}

function isRecoveredEvent(event) {
  return event.statusCode >= 200 && event.statusCode < 400 && !event.errorCode;
}

function getActiveErrorStreak(events) {
  const active = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (isRecoveredEvent(event)) break;
    if (isErrorEvent(event)) active.unshift(event);
  }
  return active;
}

function isFreshEvent(event, now = Date.now()) {
  const timestamp = Date.parse(event?.timestamp || "");
  return Number.isFinite(timestamp) && now - timestamp <= CACHE_ACTIVE_WINDOW_MS;
}

function getActiveLowCacheSamples(cacheSamples) {
  const active = [];
  for (let index = cacheSamples.length - 1; index >= 0; index -= 1) {
    const event = cacheSamples[index];
    if (!Number.isFinite(event.cacheHitRate)) continue;
    if (event.cacheHitRate >= CACHE_HIT_RISK_THRESHOLD) break;
    active.unshift(event);
  }
  return active;
}

function getActiveCacheSession(cacheSamples) {
  const session = [];
  let newerTimestamp = null;
  for (let index = cacheSamples.length - 1; index >= 0; index -= 1) {
    const event = cacheSamples[index];
    const timestamp = Date.parse(event.timestamp || "");
    if (
      session.length &&
      Number.isFinite(timestamp) &&
      Number.isFinite(newerTimestamp) &&
      newerTimestamp - timestamp > CACHE_SESSION_GAP_MS
    ) {
      break;
    }
    session.unshift(event);
    newerTimestamp = timestamp;
  }
  return session;
}

async function runDoctor({ store, config }) {
  const events = store.readEvents({ limit: 200 });
  const recent = events.slice(-20);
  const usageEvents = recent.filter((event) => event.hasUsage);
  const activeErrorEvents = getActiveErrorStreak(recent);
  const latest = events[events.length - 1] || null;
  const latestUsage = [...events].reverse().find((event) => event.hasUsage) || null;
  const today = store.getSummary();
  const claudeMemStatus = getClaudeMemStatus(config);
  const claudeMemScan = scanClaudeMem(config);
  const system = await getSystemStatus();

  const findings = [];
  let hasTokenRisk = false;

  if (!events.length) {
    findings.push({
      severity: "warning",
      title: "还没开始监控",
      evidence: [
        "还没有看到 Claude Code 通过本工具访问 DeepSeek",
        `本机监听端口: ${config.port}`,
      ],
      fixes: [
        "先在上方点击「开始监控」",
        "重启 Claude Code，让新配置生效",
        "回来点击「检测」查看缓存命中情况",
      ],
    });
  }

  if (usageEvents.length) {
    const cacheSamples = usageEvents.filter((event) => Number.isFinite(event.cacheHitRate));
    const recentHitRate = average(cacheSamples.map((event) => event.cacheHitRate));
    const latestHitRate = latestUsage?.cacheHitRate;
    const latestUsageIsFresh = isFreshEvent(latestUsage);
    const tokenVolume = sum(cacheSamples.map(cacheTokenVolume));
    const enoughCacheSamples =
      cacheSamples.length >= CACHE_MIN_SAMPLE_COUNT && tokenVolume >= CACHE_MIN_TOKEN_VOLUME;

    const activeSession = latestUsageIsFresh ? getActiveCacheSession(cacheSamples) : [];
    const activeLowSamples = getActiveLowCacheSamples(activeSession);
    const warmSamples = activeSession.slice(0, activeSession.length - activeLowSamples.length);
    const activeLowHitRate = average(activeLowSamples.map((event) => event.cacheHitRate));
    const activeLowTokenVolume = sum(activeLowSamples.map(cacheTokenVolume));
    const hasWarmedCache = warmSamples.some((event) => event.cacheHitRate >= CACHE_WARM_HIT_THRESHOLD);
    const isHeavyLowSession =
      activeLowSamples.length >= CACHE_HEAVY_LOW_COUNT &&
      activeLowTokenVolume >= CACHE_HEAVY_LOW_TOKEN_VOLUME;
    const hasActiveLowCacheRisk =
      activeLowSamples.length >= CACHE_MIN_ACTIVE_LOW_COUNT &&
      activeLowTokenVolume >= CACHE_MIN_TOKEN_VOLUME &&
      (hasWarmedCache || isHeavyLowSession) &&
      Number.isFinite(activeLowHitRate);

    if (hasActiveLowCacheRisk && activeLowHitRate < CACHE_HIT_RISK_THRESHOLD) {
      findings.push({
        severity: "critical",
        title: "缓存命中率偏低",
        evidence: [
          `连续 ${activeLowSamples.length} 次平均命中率: ${activeLowHitRate}%`,
          `连续低命中相关 Token: ${activeLowTokenVolume.toLocaleString()}`,
          latestHitRate == null ? "最近一次没有返回缓存字段" : `最近一次命中率: ${latestHitRate}%`,
        ],
        fixes: [
          "先停止当前长任务，避免继续放大未命中 Token",
          "新开小任务验证同一项目是否能恢复命中",
          "减少每轮都变化的前置内容，比如时间戳、完整文件树、动态日志、MCP 状态",
          "保持系统提示词、工具结构、项目摘要的前缀稳定",
        ],
      });
      hasTokenRisk = true;
    } else if (
      latestUsageIsFresh &&
      Number.isFinite(latestHitRate) &&
      enoughCacheSamples &&
      latestHitRate >= CACHE_HIT_RISK_THRESHOLD
    ) {
      findings.push({
        severity: "ok",
        title: recentHitRate < CACHE_HIT_RISK_THRESHOLD ? "缓存命中已恢复" : "缓存命中率正常",
        evidence: [
          `最近一次命中率: ${latestHitRate}%`,
          `当前会话相关 Token: ${sum(activeSession.map(cacheTokenVolume)).toLocaleString()}`,
          `最近 ${cacheSamples.length} 次平均仅作参考: ${recentHitRate}%`,
        ],
        fixes: ["继续保持稳定前缀，避免把频繁变化的内容放在请求开头"],
      });
    }

    const missValues = usageEvents.map((event) => event.cacheMissTokens).filter(Number.isFinite);
    if (missValues.length >= 4) {
      const latestMiss = missValues[missValues.length - 1];
      const previousAverage = average(missValues.slice(0, -1));
      if (Number.isFinite(previousAverage) && latestMiss > Math.max(previousAverage * 2.5, 100000)) {
        findings.push({
          severity: "critical",
          title: "未命中缓存 Token 突然放大",
          evidence: [
            `最近一次未命中 Token: ${latestMiss.toLocaleString()}`,
            `前几次平均未命中 Token: ${previousAverage.toLocaleString()}`,
          ],
          fixes: [
            "优先检查最近是否启用了新 MCP、视觉/OCR、自动文件索引或记忆插件",
            "回退到一个干净短会话，用同一任务做 A/B 测试",
            "确认 Claude Code 没有反复读取无关目录、构建产物、日志或锁文件",
          ],
        });
        hasTokenRisk = true;
      }
    }
  }

  if (activeErrorEvents.length >= 2) {
    findings.push({
      severity: "warning",
      title: "当前请求连续失败",
      evidence: activeErrorEvents.slice(-5).map((event) => {
        const code = event.errorCode || `HTTP ${event.statusCode}`;
        return `${event.timestamp} ${code} ${event.pathname}`;
      }),
      fixes: [
        "检查 DeepSeek 密钥是否有效",
        "检查本地代理是否能访问 api.deepseek.com",
        "如果是 401/403，优先修正 key；如果是 429，降低并发或等待限流恢复",
      ],
    });
  }

  if (claudeMemScan.warnings.length && hasTokenRisk) {
    findings.push({
      severity: "warning",
      title: "记忆插件可作为排查项",
      evidence: [
        "已同时发现 Token 或缓存异常",
        `claude-mem 总大小: ${claudeMemScan.humanTotal}`,
        ...claudeMemScan.warnings,
      ],
      fixes: [
        "先运行预检查，查看会清理哪些缓存/日志",
        "确认路径安全后再执行清理",
        "如果清理后仍反复异常，再临时禁用 claude-mem 并重启 Claude Code 做对照",
      ],
      repairActions: [
        { id: "cleanup_claude_mem_dry_run", label: "预检查清理", autoRun: true },
        { id: "cleanup_claude_mem_apply", label: "确认清理缓存/日志", confirm: true },
      ],
    });
  }

  if (claudeMemStatus.status === "enabled" && hasTokenRisk) {
    findings.push({
      severity: "info",
      title: "记忆插件可临时做对照",
      evidence: [`插件: ${claudeMemStatus.pluginId}`, `设置文件: ${claudeMemStatus.settingsPath}`],
      fixes: [
        "如果 token 异常和 claude-mem 报错同时出现，可临时禁用并重启 Claude Code 做对照",
      ],
      repairActions: [{ id: "disable_claude_mem", label: "临时禁用 claude-mem", confirm: true }],
    });
  }

  if (system.claude.count === 0) {
    findings.push({
      severity: "info",
      title: "没有检测到 Claude Code 进程",
      evidence: ["进程扫描未发现 claude/anthropic 相关命令"],
      fixes: ["启动 Claude Code 后，这里会显示进程数量、CPU 和内存"],
    });
  }

  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      today,
      latest,
      latestUsage,
      recentUsageCount: usageEvents.length,
      recentCacheHitRate: average(usageEvents.map((event) => event.cacheHitRate)),
      recentCacheMissTokens: sum(usageEvents.map((event) => event.cacheMissTokens)),
      errorCount: activeErrorEvents.length,
    },
    system,
    claudeMem: {
      status: claudeMemStatus,
      scan: claudeMemScan,
    },
    findings,
  };
}

module.exports = {
  getActiveErrorStreak,
  runDoctor,
};
