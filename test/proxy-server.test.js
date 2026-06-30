const test = require("node:test");
const assert = require("node:assert/strict");
const { makeTargetUrl } = require("../src/proxy-server");

const config = {
  port: 17860,
  deepseekBaseUrl: "https://api.deepseek.com",
  deepseekAnthropicBaseUrl: "https://api.deepseek.com/anthropic",
};

test("keeps DeepSeek Anthropic base path when proxying Claude requests", () => {
  assert.equal(
    makeTargetUrl("/anthropic/v1/messages?beta=1", config),
    "https://api.deepseek.com/anthropic/v1/messages?beta=1",
  );
});

test("proxies OpenAI-compatible requests to DeepSeek v1", () => {
  assert.equal(
    makeTargetUrl("/v1/chat/completions", config),
    "https://api.deepseek.com/v1/chat/completions",
  );
});
