const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { normalizeEvent, parseSseUsage } = require("./usage-parser");
const { runDoctor } = require("./doctor");
const { runRepair } = require("./repair");
const { clearBalanceCache, getDeepSeekBalance } = require("./balance");
const { getSystemStatus } = require("./system");
const { saveLocalSettings, validatePort } = require("./config");
const { configureClaudeCode, getClaudeConfigStatus, localClaudeBaseUrl, validateApiKey } = require("./claude-config");
const {
  buildCcSwitchProviderLink,
  connectCurrentCcSwitchProvider,
  getCcSwitchStatus,
  getCcSwitchUsageSummary,
  getCurrentClaudeProvider,
} = require("./ccswitch");

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  const text = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(text);
}

function sendCors(res) {
  res.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-api-key, anthropic-version, anthropic-beta",
  });
  res.end();
}

function sanitizeHeaders(headers, config) {
  const output = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (["host", "connection", "content-length", "accept-encoding"].includes(lower)) continue;
    output[key] = value;
  }
  if (config.deepseekApiKey) {
    output.authorization = `Bearer ${config.deepseekApiKey}`;
    output["x-api-key"] = config.deepseekApiKey;
  }
  return output;
}

function parseRequestJson(bodyBuffer) {
  if (!bodyBuffer.length) return null;
  try {
    return JSON.parse(bodyBuffer.toString("utf8"));
  } catch {
    return null;
  }
}

function joinBaseUrl(baseUrl, suffixPath, search = "") {
  const target = new URL(baseUrl);
  const basePath = target.pathname.replace(/\/+$/, "");
  const suffix = suffixPath.startsWith("/") ? suffixPath : `/${suffixPath}`;
  target.pathname = `${basePath}${suffix === "/" ? "" : suffix}`;
  target.search = search;
  return target.toString();
}

function makeTargetUrl(reqUrl, config) {
  const incoming = new URL(reqUrl, `http://127.0.0.1:${config.port}`);
  if (incoming.pathname.startsWith("/anthropic")) {
    const suffix = incoming.pathname.replace(/^\/anthropic/, "") || "/";
    return joinBaseUrl(config.deepseekAnthropicBaseUrl, suffix, incoming.search);
  }
  if (incoming.pathname.startsWith("/v1")) {
    return joinBaseUrl(config.deepseekBaseUrl, incoming.pathname, incoming.search);
  }
  if (incoming.pathname.startsWith("/deepseek")) {
    const suffix = incoming.pathname.replace(/^\/deepseek/, "") || "/";
    return joinBaseUrl(config.deepseekBaseUrl, suffix, incoming.search);
  }
  return null;
}

function copyHeaders(upstreamRes, res) {
  const headers = {};
  upstreamRes.headers.forEach((value, key) => {
    if (["content-encoding", "content-length", "transfer-encoding"].includes(key.toLowerCase())) return;
    headers[key] = value;
  });
  headers["access-control-allow-origin"] = "*";
  res.writeHead(upstreamRes.status, headers);
}

async function proxyUpstream(req, res, config, store) {
  const startedAt = Date.now();
  const targetUrl = makeTargetUrl(req.url, config);
  if (!targetUrl) {
    sendJson(res, 404, { error: "Unsupported proxy path" });
    return;
  }

  const bodyBuffer = await readBody(req);
  const requestBody = parseRequestJson(bodyBuffer);
  const pathname = new URL(req.url, `http://127.0.0.1:${config.port}`).pathname;

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: req.method,
      headers: sanitizeHeaders(req.headers, config),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : bodyBuffer,
    });

    const contentType = upstreamRes.headers.get("content-type") || "";
    const isStream = contentType.includes("text/event-stream");
    if (isStream && upstreamRes.body) {
      copyHeaders(upstreamRes, res);
      const decoder = new TextDecoder();
      let sseText = "";
      for await (const chunk of upstreamRes.body) {
        const buffer = Buffer.from(chunk);
        sseText += decoder.decode(buffer, { stream: true });
        res.write(buffer);
      }
      res.end();
      const usage = parseSseUsage(sseText);
      const event = normalizeEvent({
        payload: null,
        requestBody,
        pathname,
        statusCode: upstreamRes.status,
        latencyMs: Date.now() - startedAt,
      });
      if (usage) {
        Object.assign(event, {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          cacheHitTokens: usage.cacheHitTokens,
          cacheMissTokens: usage.cacheMissTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          cacheHitRate: usage.cacheHitRate,
          hasUsage: true,
          rawUsageShape: usage.rawUsageShape,
        });
      }
      store.append(event);
      return;
    }

    const text = await upstreamRes.text();
    const headers = {};
    upstreamRes.headers.forEach((value, key) => {
      if (key.toLowerCase() === "content-length") return;
      headers[key] = value;
    });
    headers["access-control-allow-origin"] = "*";
    res.writeHead(upstreamRes.status, headers);
    res.end(text);

    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      // Non-JSON upstream responses still get an event for error visibility.
    }
    store.append(
      normalizeEvent({
        payload,
        requestBody,
        pathname,
        statusCode: upstreamRes.status,
        latencyMs: Date.now() - startedAt,
        errorCode: payload?.error?.code || payload?.error?.type,
      }),
    );
  } catch (error) {
    const event = normalizeEvent({
      payload: null,
      requestBody,
      pathname,
      statusCode: 502,
      latencyMs: Date.now() - startedAt,
      errorCode: error.code || error.name || "proxy_error",
    });
    store.append(event);
    sendJson(res, 502, { error: "Proxy request failed", message: error.message });
  }
}

function serveStatic(req, res) {
  const rendererDir = path.join(__dirname, "renderer");
  const url = new URL(req.url, "http://127.0.0.1");
  const requested = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
  const safePath = path.normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(rendererDir, safePath);
  if (!filePath.startsWith(rendererDir) || !fs.existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
  }[ext] || "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(fs.readFileSync(filePath));
}

function createServer({ config, store }) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        sendCors(res);
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${config.port}`);
      if (url.pathname === "/api/status") {
        sendJson(res, 200, {
          config: {
            port: config.port,
            portSource: config.portSource,
            settingsPath: config.settingsPath,
            deepseekBaseUrl: config.deepseekBaseUrl,
            deepseekAnthropicBaseUrl: config.deepseekAnthropicBaseUrl,
            hasConfiguredApiKey: Boolean(config.deepseekApiKey),
            dataDir: config.dataDir,
          },
          usage: store.getSummary(),
          dashboard: store.getDashboard(),
          system: await getSystemStatus(),
        });
        return;
      }
      if (url.pathname === "/api/balance") {
        sendJson(res, 200, await getDeepSeekBalance(config));
        return;
      }
      if (url.pathname === "/api/settings") {
        if (req.method === "GET") {
          sendJson(res, 200, {
            effective: {
              port: config.port,
              portSource: config.portSource,
            },
            saved: {
              port: config.localSettings.port || null,
              hasBalanceApiKey: Boolean(config.localSettings.balanceApiKey || config.balanceApiKey),
            },
            settingsPath: config.settingsPath,
            claudeBaseUrl: `http://127.0.0.1:${config.port}/anthropic`,
            openAiBaseUrl: `http://127.0.0.1:${config.port}/v1`,
          });
          return;
        }
        if (req.method === "POST") {
          const body = parseRequestJson(await readBody(req)) || {};
          const updates = {};
          let port = config.port;
          if (body.port !== undefined) {
            port = validatePort(body.port);
            updates.port = port;
          }
          if (body.balanceApiKey !== undefined) updates.balanceApiKey = body.balanceApiKey;
          const saved = saveLocalSettings(config, updates);
          config.localSettings = saved;
          if (updates.balanceApiKey !== undefined) {
            config.balanceApiKey = saved.balanceApiKey || "";
            clearBalanceCache();
          }
          sendJson(res, 200, {
            saved,
            effective: {
              port: config.port,
              portSource: config.portSource,
            },
            restartRequired: port !== config.port,
            envOverride: config.portSource === "env",
            message: updates.balanceApiKey !== undefined && updates.port === undefined
              ? "余额 Key 已保存。"
              : port === config.port
                ? "端口已保存，当前正在使用这个端口。"
                : "端口已保存，重启应用后生效。",
          });
          return;
        }
      }
      if (url.pathname === "/api/claude-config") {
        if (req.method === "GET") {
          sendJson(res, 200, {
            claude: getClaudeConfigStatus(config, store),
            ccSwitch: getCcSwitchStatus(),
            ccSwitchCurrentProvider: getCurrentClaudeProvider(config),
            ccSwitchUsage: getCcSwitchUsageSummary(config),
          });
          return;
        }
        if (req.method === "POST") {
          const body = parseRequestJson(await readBody(req)) || {};
          try {
            validateApiKey(body.apiKey);
          } catch (error) {
            sendJson(res, 400, { error: "invalid_api_key", message: error.message });
            return;
          }
          const result = configureClaudeCode(config, body.apiKey);
          sendJson(res, 200, {
            result,
            claude: getClaudeConfigStatus(config, store),
            ccSwitch: getCcSwitchStatus(),
          message: "已配置 Claude Code。请重启 Claude Code 后再检测。",
          });
          return;
        }
      }
      if (url.pathname === "/api/ccswitch-link" && req.method === "POST") {
        const body = parseRequestJson(await readBody(req)) || {};
        let apiKey;
        try {
          apiKey = validateApiKey(body.apiKey);
        } catch (error) {
          sendJson(res, 400, { error: "invalid_api_key", message: error.message });
          return;
        }
        const endpoint = localClaudeBaseUrl(config);
        sendJson(res, 200, {
          ccSwitch: getCcSwitchStatus(),
          link: buildCcSwitchProviderLink({
            name: body.name || (body.target === "gui" ? "DeepSeek监控助手（Claude GUI）" : "DeepSeek监控助手"),
            endpoint,
            apiKey,
            model: body.model || "deepseek-chat",
            target: body.target === "gui" ? "gui" : "cli",
          }),
          endpoint,
          message:
            body.target === "gui"
              ? "已打开 CC Switch GUI 导入窗口。确认保存后，在 CC Switch 中切换到该 Provider。"
              : "已打开 CC Switch 导入窗口。确认并切换后，请重启 Claude Code。",
        });
        return;
      }
      if (url.pathname === "/api/ccswitch-connect-current" && req.method === "POST") {
        const result = connectCurrentCcSwitchProvider(config);
        sendJson(res, 200, {
          result,
          claude: getClaudeConfigStatus(config, store),
          ccSwitch: getCcSwitchStatus(),
          ccSwitchCurrentProvider: getCurrentClaudeProvider(config),
          message: "已开始监控：原 DeepSeek 配置保留不变。请重启 Claude Code 后再检测。",
        });
        return;
      }
      if (url.pathname === "/api/doctor") {
        sendJson(res, 200, await runDoctor({ store, config }));
        return;
      }
      if (url.pathname === "/api/repair" && req.method === "POST") {
        const body = parseRequestJson(await readBody(req)) || {};
        const result = await runRepair(config, body.action, body);
        sendJson(res, 200, result);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        sendJson(res, 404, { error: "Unknown API route" });
        return;
      }
      if (
        url.pathname.startsWith("/anthropic") ||
        url.pathname.startsWith("/v1") ||
        url.pathname.startsWith("/deepseek")
      ) {
        await proxyUpstream(req, res, config, store);
        return;
      }
      serveStatic(req, res);
    } catch (error) {
      sendJson(res, 500, { error: "Internal error", message: error.message });
    }
  });
}

function startServer({ config, store }) {
  const server = createServer({ config, store });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", () => resolve(server));
  });
}

module.exports = {
  createServer,
  startServer,
  makeTargetUrl,
};
