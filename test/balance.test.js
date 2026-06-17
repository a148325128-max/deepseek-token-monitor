const test = require("node:test");
const assert = require("node:assert/strict");
const { parseBalancePayload } = require("../src/balance");

test("parses DeepSeek CNY balance", () => {
  const result = parseBalancePayload({
    is_available: true,
    balance_infos: [
      {
        currency: "CNY",
        total_balance: "927.23",
        granted_balance: "0.00",
        topped_up_balance: "927.23",
      },
    ],
  });

  assert.equal(result.status, "ok");
  assert.equal(result.display, "¥927.23");
  assert.equal(result.message, "可用");
});
