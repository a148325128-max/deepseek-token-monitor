const test = require("node:test");
const assert = require("node:assert/strict");
const { parseUsagePayload, parseSseUsage, inferApiFormat } = require("../src/usage-parser");

test("parses DeepSeek cache hit and miss tokens", () => {
  const usage = parseUsagePayload({
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
    },
  });
  assert.equal(usage.inputTokens, 1000);
  assert.equal(usage.outputTokens, 200);
  assert.equal(usage.cacheHitRate, 80);
});

test("parses Anthropic-style cache fields", () => {
  const usage = parseUsagePayload({
    usage: {
      input_tokens: 1000,
      output_tokens: 50,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 100,
    },
  });
  assert.equal(usage.inputTokens, 1000);
  assert.equal(usage.outputTokens, 50);
  assert.equal(usage.cacheHitTokens, 900);
  assert.equal(usage.cacheWriteTokens, 100);
  assert.equal(usage.cacheHitRate, 90);
});

test("parses OpenAI/Zhipu cached_tokens details", () => {
  const usage = parseUsagePayload({
    usage: {
      prompt_tokens: 2000,
      completion_tokens: 300,
      prompt_tokens_details: {
        cached_tokens: 1200,
      },
    },
  });
  assert.equal(usage.cacheHitTokens, 1200);
  assert.equal(usage.cacheMissTokens, 800);
  assert.equal(usage.cacheHitRate, 60);
});

test("parses usage from SSE data lines", () => {
  const sse = [
    'data: {"type":"content_block_delta"}',
    'data: {"usage":{"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":50}}',
    "data: [DONE]",
  ].join("\n\n");
  const usage = parseSseUsage(sse);
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.cacheHitRate, 50);
});

test("infers api format", () => {
  assert.equal(inferApiFormat("/anthropic/v1/messages"), "anthropic");
  assert.equal(inferApiFormat("/v1/chat/completions"), "openai");
});
