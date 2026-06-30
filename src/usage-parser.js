function asNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function roundRate(hit, total) {
  if (!Number.isFinite(hit) || !Number.isFinite(total) || total <= 0) return undefined;
  return Number(((hit / total) * 100).toFixed(1));
}

function parseUsagePayload(payload) {
  const usage = payload && typeof payload === "object" ? payload.usage : undefined;
  if (!usage || typeof usage !== "object") return null;

  const promptTokens = asNumber(usage.prompt_tokens);
  const completionTokens = asNumber(usage.completion_tokens);
  const inputTokens = asNumber(usage.input_tokens) ?? promptTokens;
  const outputTokens = asNumber(usage.output_tokens) ?? completionTokens;
  const totalTokens =
    asNumber(usage.total_tokens) ??
    (Number.isFinite(inputTokens) || Number.isFinite(outputTokens)
      ? (inputTokens || 0) + (outputTokens || 0)
      : undefined);

  const promptDetails =
    usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
      ? usage.prompt_tokens_details
      : {};

  const cacheHitTokens =
    asNumber(usage.prompt_cache_hit_tokens) ??
    asNumber(usage.cache_read_input_tokens) ??
    asNumber(usage.cached_input_tokens) ??
    asNumber(promptDetails.cached_tokens);

  const cacheMissTokens =
    asNumber(usage.prompt_cache_miss_tokens) ??
    (Number.isFinite(inputTokens) && Number.isFinite(cacheHitTokens)
      ? Math.max(inputTokens - cacheHitTokens, 0)
      : undefined);

  const cacheWriteTokens =
    asNumber(usage.cache_creation_input_tokens) ??
    asNumber(usage.cache_creation?.input_tokens);

  const cacheDenominator =
    Number.isFinite(cacheHitTokens) && Number.isFinite(cacheMissTokens)
      ? cacheHitTokens + cacheMissTokens
      : inputTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheHitTokens,
    cacheMissTokens,
    cacheWriteTokens,
    cacheHitRate: roundRate(cacheHitTokens, cacheDenominator),
    rawUsageShape: Object.keys(usage).sort(),
  };
}

function parseSseUsage(text) {
  let lastUsage = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const payload = JSON.parse(data);
      const parsed = parseUsagePayload(payload);
      if (parsed) lastUsage = parsed;
    } catch {
      // Ignore non-JSON stream keepalives.
    }
  }
  return lastUsage;
}

function inferApiFormat(pathname) {
  if (pathname.startsWith("/anthropic")) return "anthropic";
  if (pathname.includes("/messages")) return "anthropic";
  if (pathname.includes("/chat/completions")) return "openai";
  return "unknown";
}

function normalizeEvent({ payload, requestBody, pathname, statusCode, latencyMs, errorCode }) {
  const usage = payload ? parseUsagePayload(payload) : null;
  const model =
    (payload && typeof payload === "object" && payload.model) ||
    (requestBody && typeof requestBody === "object" && requestBody.model) ||
    "unknown";

  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    provider: "deepseek",
    apiFormat: inferApiFormat(pathname),
    pathname,
    model,
    statusCode,
    latencyMs,
    errorCode,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
    cacheHitTokens: usage?.cacheHitTokens,
    cacheMissTokens: usage?.cacheMissTokens,
    cacheWriteTokens: usage?.cacheWriteTokens,
    cacheHitRate: usage?.cacheHitRate,
    hasUsage: Boolean(usage),
    rawUsageShape: usage?.rawUsageShape,
  };
}

module.exports = {
  parseUsagePayload,
  parseSseUsage,
  normalizeEvent,
  inferApiFormat,
};
