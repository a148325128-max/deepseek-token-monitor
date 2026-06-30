const $ = (id) => document.getElementById(id);
const CACHE_MIN_SAMPLE_COUNT = 5;
const CACHE_MIN_TOKEN_VOLUME = 80000;
const CACHE_MIN_DISPLAY_HIT_TOKENS = 10000;
const CACHE_HEAVY_DISPLAY_TOKEN_VOLUME = 300000;
const AUTO_REFRESH_MS = 15000;
let balanceFormForcedOpen = false;
let accessFormForcedOpen = false;
let lastDoctorFindings = [];

function compactNumber(value) {
  if (!Number.isFinite(value)) return "--";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

function humanNumber(value) {
  if (!Number.isFinite(value)) return "--";
  return Math.round(value).toLocaleString();
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--";
  return `${Math.round(value)}%`;
}

function formatCny(value) {
  if (!Number.isFinite(value)) return "--";
  if (value > 0 && value < 0.01) return "¥<0.01";
  return `¥${value.toFixed(2)}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function formatLoadPercent(value) {
  if (!Number.isFinite(value)) return "--";
  if (value > 0 && value < 10 && value % 1 !== 0) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

function setCurrencyDisplay(element, display) {
  if (!element) return;
  const text = String(display || "--");
  const match = text.match(/^([¥$])(.+)$/);
  if (!match) {
    element.textContent = text;
    return;
  }
  element.innerHTML = `<span class="currency-symbol">${escapeHtml(match[1])}</span>${escapeHtml(match[2])}`;
}

function setDailyCostDisplay(element, value) {
  if (!element) return;
  const display = formatCny(value);
  const match = display.match(/^([¥$])(.+)$/);
  const amount = match
    ? `<strong><span class="currency-symbol">${escapeHtml(match[1])}</span>${escapeHtml(match[2])}</strong>`
    : `<strong>${escapeHtml(display)}</strong>`;
  element.innerHTML = `<span>今日预估消耗</span>${amount}`;
}

function usageRequestCount(usage) {
  return usage?.requests ?? usage?.requestCount ?? 0;
}

function cacheTokenVolume(usage) {
  const cacheTokens = (usage?.cacheHitTokens || 0) + (usage?.cacheMissTokens || 0);
  return cacheTokens || usage?.inputTokens || 0;
}

function shouldShowCacheHitRate(usage) {
  const volume = cacheTokenVolume(usage);
  return (
    usageRequestCount(usage) >= CACHE_MIN_SAMPLE_COUNT &&
    volume >= CACHE_MIN_TOKEN_VOLUME &&
    ((usage?.cacheHitTokens || 0) >= CACHE_MIN_DISPLAY_HIT_TOKENS || volume >= CACHE_HEAVY_DISPLAY_TOKEN_VOLUME) &&
    Number.isFinite(usage?.cacheHitRate)
  );
}

function severityClass(findings) {
  if (findings.some((finding) => finding.severity === "critical")) return "critical";
  if (findings.some((finding) => finding.severity === "warning")) return "warning";
  if (findings.some((finding) => finding.severity === "ok")) return "ok";
  return "neutral";
}

function repairActions(findings) {
  return findings.flatMap((finding) => finding.repairActions || []);
}

function autoRepairActions(findings) {
  return repairActions(findings).filter((action) => action.autoRun && !action.confirm);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\n/g, "&#10;");
}

async function refresh() {
  const [status, doctor, settings, claudeConfig, balance] = await Promise.all([
    fetch("/api/status").then((res) => res.json()),
    fetch("/api/doctor").then((res) => res.json()),
    fetch("/api/settings").then((res) => res.json()),
    fetch("/api/claude-config").then((res) => res.json()),
    fetch("/api/balance").then((res) => res.json()),
  ]);

  renderDashboard(status, doctor, claudeConfig, balance);
  renderConnectState(settings, claudeConfig, status);
  renderDoctor(doctor.findings);
}

function renderDashboard(status, doctor, claudeConfig, balance) {
  const usage = status.usage || {};
  const dashboard = status.dashboard || { trend: [], models: [] };
  const findings = doctor.findings || [];
  lastDoctorFindings = findings;
  const cls = severityClass(findings);
  const monitorReady =
    claudeConfig?.ccSwitchCurrentProvider?.provider?.alreadyProxied || claudeConfig?.claude?.configured;
  const isMonitoring = usageRequestCount(usage) > 0;

  $("today-token").textContent = compactNumber(usage.totalTokens);
  $("summary-input").textContent = compactNumber(usage.inputTokens);
  $("summary-output").textContent = compactNumber(usage.outputTokens);
  $("summary-cache-hit").textContent = compactNumber(usage.cacheHitTokens);
  $("summary-cache-miss").textContent = compactNumber(usage.cacheMissTokens);
  setCurrencyDisplay($("balance-amount"), balance?.display || "--");
  $("balance-note").textContent = balance?.message || "未授权";
  $("balance-note").className = `balance-note ${balance?.status || "missing_key"}`;
  setDailyCostDisplay($("today-cost"), usage.estimatedCostCny);
  $("request-count").textContent = humanNumber(usageRequestCount(usage));
  $("hit").textContent = shouldShowCacheHitRate(usage) ? formatPercent(usage.cacheHitRate) : "--";
  $("monitor-badge").className = `status-badge ${isMonitoring ? "ok" : monitorReady ? "ready" : "neutral"}`;
  $("monitor-badge").textContent = isMonitoring ? "监控中" : monitorReady ? "已准备" : "待开始";

  renderSystemStrip(status.system);
  renderDoctorCta({ findings, monitorReady, isMonitoring });
  renderModels(dashboard.models || []);
  renderTrend(dashboard.trend || [], findings);
  $("doctor-indicator").className = `doctor-indicator ${cls}`;
}

function renderSystemStrip(system) {
  const cpuText = Number.isFinite(system?.cpu?.usedPercent)
    ? `CPU ${formatLoadPercent(system.cpu.usedPercent)}`
    : "CPU --";
  const memoryText = Number.isFinite(system?.memory?.usedPercent)
    ? `${system.memory.displayMode === "pressure" ? "内存压力" : "内存"} ${formatLoadPercent(system.memory.usedPercent)}`
    : "内存 --";

  $("system-cpu").textContent = cpuText;
  $("system-memory").textContent = memoryText;
}

function renderDoctorCta({ findings, monitorReady, isMonitoring }) {
  const button = $("doctor-cta");
  if (!button) return;
  const cls = severityClass(findings);
  const hasRepairActions = repairActions(findings).length > 0;
  button.className = `doctor-cta ${cls}`;
  if (hasRepairActions) {
    button.textContent = "一键修复可处理项";
  } else if (!monitorReady && !isMonitoring) {
    button.textContent = "一键体检";
  } else if (findings.some((finding) => finding.severity === "critical" || finding.severity === "warning")) {
    button.textContent = "查看修复建议";
  } else {
    button.textContent = "一键体检";
  }
}

function renderModels(models) {
  const byId = Object.fromEntries(models.map((model) => [model.id, model]));
  renderModelRow("flash", byId.flash || {});
  renderModelRow("pro", byId.pro || {});
}

function renderModelRow(id, model) {
  const total = model.totalTokens || 0;
  const requests = model.requests || 0;
  const share = Math.max(3, Math.min(100, model.share || 0));
  $(`${id}-total`).textContent = `${humanNumber(total)} Token`;
  $(`${id}-cost`).textContent = requests ? `${requests} 次` : "暂无";
  $(`${id}-meter`).style.width = total ? `${share}%` : "3%";
  $(`${id}-meter`).parentElement.title = `${model.label || id}: ${humanNumber(total)} Token`;
}

function renderTrend(days, findings) {
  const max = Math.max(1, ...days.map((day) => day.totalTokens || 0));
  const hasCritical = findings.some((finding) => finding.severity === "critical");
  const hasWarning = findings.some((finding) => finding.severity === "warning");
  const risk = $("trend-risk");
  risk.className = `risk-pill ${hasCritical ? "critical" : hasWarning ? "warning" : "ok"}`;
  risk.textContent = hasCritical ? "需体检" : hasWarning ? "提醒" : "健康";

  const total = days.reduce((sum, day) => sum + (day.totalTokens || 0), 0);
  $("trend-total").textContent = `近 7 日合计 ${compactNumber(total)} Token`;
  $("trend-chart").innerHTML = days
    .map((day) => {
      const totalTokens = day.totalTokens || 0;
      const height = totalTokens ? Math.max(10, Math.round((totalTokens / max) * 112)) : 4;
      const hit = day.cacheHitTokens || 0;
      const miss = day.cacheMissTokens || 0;
      const out = day.outputTokens || 0;
      const stackTotal = Math.max(1, hit + miss + out);
      const hitHeight = Math.max(hit ? 4 : 0, Math.round((hit / stackTotal) * height));
      const missHeight = Math.max(miss ? 4 : 0, Math.round((miss / stackTotal) * height));
      const outHeight = Math.max(out ? 4 : 0, Math.round((out / stackTotal) * height));
      const cacheReady = day.requests >= CACHE_MIN_SAMPLE_COUNT && cacheTokenVolume(day) >= CACHE_MIN_TOKEN_VOLUME;
      const riskClass = cacheReady && Number.isFinite(day.cacheHitRate) && day.cacheHitRate < 60 ? "risk" : "";
      const title = [
        `${day.date} ${humanNumber(totalTokens)} Token`,
        `命中 ${humanNumber(hit)}`,
        `未命中 ${humanNumber(miss)}`,
        `输出 ${humanNumber(out)}`,
        cacheReady ? `命中率 ${formatPercent(day.cacheHitRate)}` : "命中率样本不足",
      ].join("\n");
      return `
        <div class="bar-cell" data-tooltip="${escapeAttr(title)}">
          <div class="bar-stack ${riskClass}" style="height:${height}px">
            <i class="out" style="height:${outHeight}px"></i>
            <i class="miss" style="height:${missHeight}px"></i>
            <i class="hit" style="height:${hitHeight}px"></i>
          </div>
          <span>${escapeHtml(day.label)}</span>
        </div>
      `;
    })
    .join("");
}

function shellCommands(settings, platform) {
  const baseUrl = settings.claudeBaseUrl;
  if (platform === "win32") {
    return [
      `set ANTHROPIC_BASE_URL=${baseUrl}`,
      'set ANTHROPIC_AUTH_TOKEN=sk-粘贴新建的DeepSeekKey',
      "REM 以上两行用于 CMD；PowerShell 用户请用：",
      `$env:ANTHROPIC_BASE_URL="${baseUrl}"`,
      '$env:ANTHROPIC_AUTH_TOKEN="sk-粘贴新建的DeepSeekKey"',
      "claude",
    ].join("\n");
  }
  return [
    `export ANTHROPIC_BASE_URL="${baseUrl}"`,
    'export ANTHROPIC_AUTH_TOKEN="sk-粘贴新建的DeepSeekKey"',
    "claude",
  ].join("\n");
}

function renderConnectState(settings, claudeConfig, status) {
  const currentProvider = claudeConfig?.ccSwitchCurrentProvider?.provider;
  const canReuseCcSwitch = currentProvider?.hasAuthToken && !currentProvider?.alreadyProxied;
  const isProxied = currentProvider?.alreadyProxied || claudeConfig?.claude?.configured;
  const platform = status?.system?.platform || "darwin";
  const button = $("connect-ccswitch-current");
  if (button) {
    button.hidden = false;
    if (canReuseCcSwitch) {
      button.dataset.mode = "connect";
      button.textContent = "开始监控";
    } else if (isProxied) {
      button.dataset.mode = "ready";
      button.textContent = "监控配置已准备";
    } else {
      button.dataset.mode = "settings";
      button.textContent = "配置 Key 开始监控";
    }
  }
  renderSettingsKeyState({ settings, claudeConfig, currentProvider, canReuseCcSwitch, isProxied });
  $("settings-message").textContent = isProxied
    ? "监控配置已准备。原 DeepSeek 可随时切回。"
    : canReuseCcSwitch
      ? `已找到 ${currentProvider.name}，可一键开始监控。`
      : "没有自动找到配置时，再用手动方式。";

  const commandBox = $("claude-command");
  if (commandBox) {
    commandBox.textContent = shellCommands(settings, platform);
  }
}

function setHidden(id, hidden) {
  const element = $(id);
  if (element) element.hidden = hidden;
}

function renderSettingsKeyState({ settings, currentProvider, canReuseCcSwitch, isProxied }) {
  const hasBalanceKey = Boolean(settings?.saved?.hasBalanceApiKey);
  setHidden("balance-key-state", !hasBalanceKey || balanceFormForcedOpen);
  setHidden("balance-key-form", hasBalanceKey && !balanceFormForcedOpen);

  const accessReady = Boolean(isProxied || canReuseCcSwitch);
  setHidden("access-key-state", !accessReady || accessFormForcedOpen);
  setHidden("access-key-form", accessReady && !accessFormForcedOpen);

  const title = $("access-key-title");
  const desc = $("access-key-desc");
  if (title) title.textContent = isProxied ? "当前接入已准备" : "已找到现有 DeepSeek 配置";
  if (desc) {
    desc.textContent = currentProvider?.name
      ? `当前：${currentProvider.name}`
      : "Claude Code 已经可以通过本工具监控";
  }
}

function renderDoctor(findings) {
  const cls = severityClass(findings);
  const criticalCount = findings.filter((finding) => finding.severity === "critical").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const repairCount = repairActions(findings).length;
  const title = repairCount ? "有可处理项" : criticalCount ? "发现高风险" : warningCount ? "有提醒" : "状态正常";
  const text = repairCount
    ? `${repairCount} 个动作可处理，关键操作会先确认`
    : criticalCount
    ? `${criticalCount} 项需要处理`
    : warningCount
      ? `${warningCount} 项可查看`
      : "没有发现明显异常";

  $("doctor-title").textContent = title;
  $("doctor-text").textContent = text;
  $("doctor-indicator").className = `doctor-indicator ${cls}`;
  $("doctor-indicator").textContent = criticalCount || warningCount ? "!" : "✓";
  renderFindings(findings);
}

function renderFindings(findings) {
  const openTitles = new Set(
    Array.from(document.querySelectorAll("#findings details[open] .finding-copy strong")).map((item) => item.textContent),
  );
  $("findings").innerHTML = findings.length
    ? findings
        .map((finding) => {
          const evidence = (finding.evidence || []).slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
          const fixes = (finding.fixes || []).slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
          const actions = (finding.repairActions || [])
            .map(
              (action) =>
                `<button data-action="${escapeHtml(action.id)}" data-confirm="${action.confirm ? "true" : "false"}">${escapeHtml(action.label)}</button>`,
            )
            .join("");
          return `
            <details class="finding ${finding.severity}" ${openTitles.has(finding.title) ? "open" : ""}>
              <summary>
                <span class="severity-label">${severityLabel(finding.severity)}</span>
                <span class="finding-copy">
                  <strong>${escapeHtml(finding.title)}</strong>
                  <small>${escapeHtml(oneLineSummary(finding))}</small>
                </span>
              </summary>
              <div class="finding-detail">
                ${evidence ? `<p>原因</p><ul>${evidence}</ul>` : ""}
                ${fixes ? `<p>建议</p><ul>${fixes}</ul>` : ""}
                ${actions ? `<div class="actions">${actions}</div>` : ""}
              </div>
            </details>
          `;
        })
        .join("")
    : `<div class="empty-finding">当前没有需要处理的项目。</div>`;
}

function severityLabel(severity) {
  return {
    critical: "高风险",
    warning: "提醒",
    info: "提示",
    ok: "正常",
  }[severity] || "状态";
}

function oneLineSummary(finding) {
  if (finding.title.includes("还没接入") || finding.title.includes("还没开始")) return "还没收到 Claude Code 请求";
  if (finding.title.includes("记忆插件可作为排查项")) return "仅在 Token 异常时建议检查";
  if (finding.title.includes("当前请求连续失败")) return "可能是 Key 或网络问题";
  if (finding.title.includes("命中率偏低")) return "可能正在多花输入 Token";
  if (finding.title.includes("未命中")) return "最近一次请求成本可能异常";
  return (finding.evidence || finding.fixes || ["点击查看详情"])[0] || "点击查看详情";
}

function repairConfirmMessage(action) {
  if (action === "cleanup_claude_mem_apply") return "这个操作会清理已知 claude-mem 缓存/日志路径。确认执行？";
  if (action === "disable_claude_mem") return "这个操作会临时禁用 claude-mem，并自动备份 Claude 设置。确认执行？";
  if (action === "enable_claude_mem") return "这个操作会重新启用 claude-mem，并自动备份 Claude 设置。确认执行？";
  return "这个操作会修改本机配置，并自动创建备份。确认执行？";
}

async function repair(action, needsConfirm, options = {}) {
  if (needsConfirm && !confirm(repairConfirmMessage(action))) return null;
  const res = await fetch("/api/repair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, confirm: needsConfirm }),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.message || payload.error || "修复失败");
  if (options.showOutput !== false) {
    $("repair-output").hidden = false;
    $("repair-output").textContent = JSON.stringify(payload, null, 2);
  }
  if (options.refresh !== false) await refresh();
  return payload;
}

async function runAutoRepairs(findings) {
  const actions = autoRepairActions(findings);
  if (!actions.length) return false;
  const results = [];
  for (const action of actions) {
    results.push(await repair(action.id, false, { refresh: false, showOutput: false }));
  }
  $("repair-output").hidden = false;
  $("repair-output").textContent = JSON.stringify({ action: "auto_repair", results }, null, 2);
  await refresh();
  return true;
}

function readApiKeyInput() {
  return $("api-key-input").value.trim();
}

async function openCcSwitchImportLink(link) {
  const bridge = window.deepseekMonitor;
  let copied = false;
  let opened = false;

  if (bridge?.copyText) {
    try {
      await bridge.copyText(link);
      copied = true;
    } catch {
      copied = false;
    }
  }

  if (bridge?.openExternal) {
    await bridge.openExternal(link);
    opened = true;
  } else {
    window.location.href = link;
    opened = true;
  }

  return { opened, copied };
}

async function importCcSwitch(target = "cli") {
  const apiKey = readApiKeyInput();
  const res = await fetch("/api/ccswitch-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey, target }),
  });
  const payload = await res.json();
  if (!res.ok) {
    $("settings-message").textContent = payload.message || payload.error || "生成 CC Switch 导入链接失败";
    return;
  }
  try {
    const result = await openCcSwitchImportLink(payload.link);
    $("settings-message").textContent = result.copied
      ? `${payload.message} 导入链接已复制；请在 CC Switch 中确认保存。`
      : payload.message;
    $("api-key-input").value = "";
    accessFormForcedOpen = false;
  } catch (error) {
    $("settings-message").textContent = `没有自动打开 CC Switch：${error.message}。请确认已安装 CC Switch，或改用「不用 CC Switch，直接使用」。`;
  }
  setTimeout(() => refresh().catch(console.error), 1200);
}

function closePanel() {
  if (window.deepseekMonitor?.hideWindow) {
    window.deepseekMonitor.hideWindow().catch(() => setSettingsPanelOpen(false));
    return;
  }
  setSettingsPanelOpen(false);
}

async function configureClaude() {
  const apiKey = readApiKeyInput();
  const res = await fetch("/api/claude-config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  const payload = await res.json();
  if (!res.ok) {
    $("settings-message").textContent = payload.message || payload.error || "配置失败";
    return;
  }
  $("api-key-input").value = "";
  accessFormForcedOpen = false;
  $("settings-message").textContent = payload.message;
  await refresh();
}

async function saveBalanceKey() {
  const apiKey = $("balance-key-input").value.trim();
  if (!apiKey) {
    $("settings-message").textContent = "请先粘贴用于查询余额的 DeepSeek Key。";
    return;
  }
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ balanceApiKey: apiKey }),
  });
  const payload = await res.json();
  if (!res.ok) {
    $("settings-message").textContent = payload.message || payload.error || "保存失败";
    return;
  }
  $("balance-key-input").value = "";
  balanceFormForcedOpen = false;
  $("settings-message").textContent = "余额 Key 已保存，只用于查询余额。";
  await refresh();
}

async function connectCcSwitchCurrent() {
  const button = $("connect-ccswitch-current");
  if (button?.dataset.mode === "settings") {
    setSettingsPanelOpen(true);
    accessFormForcedOpen = true;
    setHidden("access-key-state", true);
    setHidden("access-key-form", false);
    $("settings-message").textContent = "粘贴 DeepSeek Key 后，推荐保存到 CC Switch；没有 CC Switch 就直接使用。";
    $("api-key-input")?.focus();
    return;
  }
  if (button?.dataset.mode === "ready") {
    await refresh();
    openDoctorPanel();
    return;
  }
  const res = await fetch("/api/ccswitch-connect-current", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const payload = await res.json();
  if (!res.ok) {
    $("settings-message").textContent = payload.message || payload.error || "接入 CC Switch 当前配置失败";
    return;
  }
  $("settings-message").textContent = payload.message;
  accessFormForcedOpen = false;
  await refresh();
}

function toggleDoctorPanel() {
  const panel = $("doctor-panel");
  const button = $("doctor-toggle");
  const next = panel.hidden;
  panel.hidden = !next;
  button.setAttribute("aria-expanded", String(next));
}

function openDoctorPanel() {
  const panel = $("doctor-panel");
  const button = $("doctor-toggle");
  if (!panel || !button) return;
  panel.hidden = false;
  button.setAttribute("aria-expanded", "true");
  $("doctor-toggle").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function setSettingsPanelOpen(open) {
  const panel = $("settings-panel");
  const button = $("settings-toggle");
  if (!panel || !button) return;
  panel.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}

function toggleSettingsPanel() {
  const panel = $("settings-panel");
  if (!panel) return;
  setSettingsPanelOpen(panel.hidden);
}

let activeTooltipCell = null;

function getChartTooltip() {
  let tooltip = $("chart-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "chart-tooltip";
    tooltip.className = "chart-tooltip";
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function renderTooltipContent(text) {
  const lines = String(text || "").split("\n").filter(Boolean);
  const [title, ...items] = lines;
  return [
    `<strong>${escapeHtml(title || "暂无数据")}</strong>`,
    ...items.map((item) => `<span>${escapeHtml(item)}</span>`),
  ].join("");
}

function positionChartTooltip(event) {
  const tooltip = getChartTooltip();
  if (tooltip.hidden) return;
  const gap = 12;
  const margin = 10;
  const rect = tooltip.getBoundingClientRect();
  let left = event.clientX + gap;
  let top = event.clientY - 8;

  if (left + rect.width + margin > window.innerWidth) left = event.clientX - rect.width - gap;
  if (top + rect.height + margin > window.innerHeight) top = window.innerHeight - rect.height - margin;

  tooltip.style.transform = `translate(${Math.max(margin, Math.round(left))}px, ${Math.max(margin, Math.round(top))}px)`;
}

function showChartTooltip(cell, event) {
  const tooltip = getChartTooltip();
  activeTooltipCell = cell;
  tooltip.innerHTML = renderTooltipContent(cell.dataset.tooltip);
  tooltip.hidden = false;
  positionChartTooltip(event);
}

function hideChartTooltip() {
  activeTooltipCell = null;
  getChartTooltip().hidden = true;
}

function bindChartTooltip() {
  const chart = $("trend-chart");
  if (!chart) return;

  chart.addEventListener("pointerover", (event) => {
    const cell = event.target.closest(".bar-cell");
    if (!cell || !chart.contains(cell) || cell === activeTooltipCell) return;
    showChartTooltip(cell, event);
  });

  chart.addEventListener("pointermove", (event) => {
    const cell = event.target.closest(".bar-cell");
    if (!cell || !chart.contains(cell)) {
      hideChartTooltip();
      return;
    }
    if (cell !== activeTooltipCell) showChartTooltip(cell, event);
    positionChartTooltip(event);
  });

  chart.addEventListener("pointerleave", hideChartTooltip);
  window.addEventListener("blur", hideChartTooltip);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  repair(button.dataset.action, button.dataset.confirm === "true").catch((error) => {
    $("repair-output").hidden = false;
    $("repair-output").textContent = error.stack || error.message;
  });
});

document.addEventListener("click", (event) => {
  const panel = $("settings-panel");
  if (!panel || panel.hidden) return;
  if (event.target.closest("#settings-panel, #settings-toggle, #connect-ccswitch-current")) return;
  setSettingsPanelOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setSettingsPanelOpen(false);
});

function on(id, eventName, handler) {
  const element = $(id);
  if (element) element.addEventListener(eventName, handler);
}

on("refresh", "click", () => refresh().catch(console.error));
on("settings-toggle", "click", toggleSettingsPanel);
on("close-panel", "click", closePanel);
on("doctor-toggle", "click", toggleDoctorPanel);
on("change-balance-key", "click", () => {
  balanceFormForcedOpen = true;
  setHidden("balance-key-state", true);
  setHidden("balance-key-form", false);
  $("balance-key-input")?.focus();
});
on("change-access-key", "click", () => {
  accessFormForcedOpen = true;
  setHidden("access-key-state", true);
  setHidden("access-key-form", false);
  $("api-key-input")?.focus();
});
on("doctor-cta", "click", async () => {
  const button = $("doctor-cta");
  button.classList.add("loading");
  try {
    await refresh();
    await runAutoRepairs(lastDoctorFindings);
    openDoctorPanel();
  } catch (error) {
    $("doctor-text").textContent = `体检失败：${error.message}`;
  } finally {
    button.classList.remove("loading");
  }
});
on("import-ccswitch", "click", () => importCcSwitch("cli").catch((error) => {
  $("settings-message").textContent = `导入失败：${error.message}`;
}));
on("import-ccswitch-gui", "click", () => importCcSwitch("gui").catch((error) => {
  $("settings-message").textContent = `导入失败：${error.message}`;
}));
on("configure-claude", "click", () => configureClaude().catch((error) => {
  $("settings-message").textContent = `配置失败：${error.message}`;
}));
on("save-balance-key", "click", () => saveBalanceKey().catch((error) => {
  $("settings-message").textContent = `保存失败：${error.message}`;
}));
on("connect-ccswitch-current", "click", () => connectCcSwitchCurrent().catch((error) => {
  $("settings-message").textContent = `接入失败：${error.message}`;
}));

bindChartTooltip();
window.refresh = refresh;
refresh().catch(console.error);
setInterval(() => refresh().catch(console.error), AUTO_REFRESH_MS);
