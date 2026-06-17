const fs = require("node:fs");
const path = require("node:path");

function emptyTotals(extra = {}) {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    estimatedCostCny: 0,
    ...extra,
  };
}

const PRICING_CNY_PER_MILLION = {
  flash: { cacheHit: 0.02, cacheMiss: 1, output: 2 },
  pro: { cacheHit: 0.025, cacheMiss: 3, output: 6 },
  other: { cacheHit: 0.02, cacheMiss: 1, output: 2 },
};

function normalizeModel(model) {
  const text = String(model || "").toLowerCase();
  if (text.includes("flash") || text.includes("chat")) return "flash";
  if (text.includes("pro")) return "pro";
  return "other";
}

function estimateCostCny(event) {
  const pricing = PRICING_CNY_PER_MILLION[normalizeModel(event.model)] || PRICING_CNY_PER_MILLION.other;
  const hit = Number(event.cacheHitTokens) || 0;
  const miss =
    Number(event.cacheMissTokens) ||
    Math.max((Number(event.inputTokens) || 0) - hit, 0);
  const out = Number(event.outputTokens) || 0;
  return (hit * pricing.cacheHit + miss * pricing.cacheMiss + out * pricing.output) / 1_000_000;
}

function addUsage(target, event) {
  target.requests += 1;
  target.inputTokens += event.inputTokens || 0;
  target.outputTokens += event.outputTokens || 0;
  target.totalTokens += event.totalTokens || 0;
  target.cacheHitTokens += event.cacheHitTokens || 0;
  target.cacheMissTokens += event.cacheMissTokens || 0;
  target.estimatedCostCny += estimateCostCny(event);
}

function finishTotals(target) {
  const denominator = target.cacheHitTokens + target.cacheMissTokens;
  return {
    ...target,
    estimatedCostCny: Number(target.estimatedCostCny.toFixed(4)),
    cacheHitRate:
      denominator > 0 ? Number(((target.cacheHitTokens / denominator) * 100).toFixed(1)) : null,
  };
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayLabel(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

class EventStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.eventsPath = path.join(dataDir, "usage-events.jsonl");
    fs.mkdirSync(dataDir, { recursive: true });
  }

  append(event) {
    fs.appendFileSync(this.eventsPath, JSON.stringify(event) + "\n", "utf8");
  }

  readEvents({ limit = 500, sinceMs } = {}) {
    if (!fs.existsSync(this.eventsPath)) return [];
    const text = fs.readFileSync(this.eventsPath, "utf8").trim();
    if (!text) return [];
    const since = sinceMs ? Date.now() - sinceMs : undefined;
    const events = [];
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0 && events.length < limit; i -= 1) {
      try {
        const event = JSON.parse(lines[i]);
        if (since && Date.parse(event.timestamp) < since) break;
        events.push(event);
      } catch {
        // Skip corrupted partial lines.
      }
    }
    return events.reverse();
  }

  getSummary() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEvents = this.readEvents({ limit: 5000 }).filter(
      (event) => Date.parse(event.timestamp) >= todayStart.getTime(),
    );
    const usageEvents = todayEvents.filter((event) => event.hasUsage);
    const totals = usageEvents.reduce(
      (acc, event) => {
        addUsage(acc, event);
        return acc;
      },
      emptyTotals({
        errors: todayEvents.filter((event) => event.statusCode >= 400 || event.errorCode).length,
      }),
    );
    Object.assign(totals, finishTotals(totals));
    totals.lastEvent = todayEvents[todayEvents.length - 1] || null;
    return totals;
  }

  getDashboard({ days = 7 } = {}) {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    const dayMap = new Map();
    for (let i = 0; i < days; i += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      dayMap.set(localDateKey(date), emptyTotals({ date: localDateKey(date), label: dayLabel(date) }));
    }

    const modelMap = new Map([
      ["flash", emptyTotals({ id: "flash", label: "V4 Flash" })],
      ["pro", emptyTotals({ id: "pro", label: "V4 Pro" })],
    ]);

    const events = this.readEvents({ limit: 10000 }).filter((event) => {
      const timestamp = Date.parse(event.timestamp);
      return Number.isFinite(timestamp) && timestamp >= start.getTime();
    });
    const usageEvents = events.filter((event) => event.hasUsage);

    for (const event of usageEvents) {
      const date = new Date(event.timestamp);
      const key = localDateKey(date);
      if (dayMap.has(key)) addUsage(dayMap.get(key), event);

      const modelKey = normalizeModel(event.model);
      if (!modelMap.has(modelKey)) {
        modelMap.set(modelKey, emptyTotals({ id: modelKey, label: event.model || "Other" }));
      }
      addUsage(modelMap.get(modelKey), event);
    }

    const trend = Array.from(dayMap.values()).map(finishTotals);
    const maxDailyTokens = Math.max(1, ...trend.map((day) => day.totalTokens));
    const finishedModels = Array.from(modelMap.values()).map(finishTotals);
    const maxModelTokens = Math.max(1, ...finishedModels.map((model) => model.totalTokens));
    const models = finishedModels
      .map((model) => ({
        ...model,
        share: Math.min(100, Math.round((model.totalTokens / maxModelTokens) * 100)),
      }))
      .filter((model) => ["flash", "pro"].includes(model.id));

    return {
      days,
      trend,
      models,
      maxDailyTokens,
    };
  }
}

module.exports = {
  EventStore,
  estimateCostCny,
};
