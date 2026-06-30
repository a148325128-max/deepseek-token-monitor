let cachedBalance = null;
let cachedAt = 0;
const BALANCE_CACHE_MS = 120000;

function clearBalanceCache() {
  cachedBalance = null;
  cachedAt = 0;
}

function currencyPrefix(currency) {
  const normalized = String(currency || "").toUpperCase();
  if (normalized === "CNY") return "¥";
  if (normalized === "USD") return "$";
  return "";
}

function parseBalancePayload(payload) {
  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : [];
  const preferred = infos.find((item) => item.currency === "CNY") || infos[0] || null;
  if (!preferred) {
    return {
      available: Boolean(payload?.is_available),
      status: "empty",
      display: "--",
      message: "暂无余额数据",
      rawAvailable: payload?.is_available,
    };
  }

  const total = Number(preferred.total_balance);
  return {
    available: Boolean(payload?.is_available),
    status: "ok",
    currency: preferred.currency,
    totalBalance: Number.isFinite(total) ? total : null,
    grantedBalance: preferred.granted_balance,
    toppedUpBalance: preferred.topped_up_balance,
    display: `${currencyPrefix(preferred.currency)}${Number.isFinite(total) ? total.toFixed(2) : preferred.total_balance}`,
    message: payload?.is_available ? "可用" : "不可用",
  };
}

async function getDeepSeekBalance(config, options = {}) {
  const apiKey = config.balanceApiKey || config.deepseekApiKey;
  if (!apiKey) {
    return {
      available: false,
      status: "missing_key",
      display: "--",
      message: "未授权",
    };
  }

  const now = Date.now();
  if (!options.force && cachedBalance && now - cachedAt < BALANCE_CACHE_MS) return cachedBalance;

  try {
    const res = await fetch(`${config.deepseekBaseUrl.replace(/\/+$/, "")}/user/balance`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        available: false,
        status: "error",
        display: "--",
        message: payload?.error?.message || `余额查询失败 ${res.status}`,
      };
    }
    cachedBalance = parseBalancePayload(payload);
    cachedAt = now;
    return cachedBalance;
  } catch (error) {
    return {
      available: false,
      status: "error",
      display: "--",
      message: error.message,
    };
  }
}

module.exports = {
  clearBalanceCache,
  getDeepSeekBalance,
  parseBalancePayload,
};
