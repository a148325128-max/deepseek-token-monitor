const { loadConfig } = require("./config");
const { EventStore } = require("./store");
const { startServer } = require("./proxy-server");

async function main() {
  const config = loadConfig();
  const store = new EventStore(config.dataDir);
  await startServer({ config, store });
  console.log(`DeepSeek监控助手 running at http://127.0.0.1:${config.port}`);
  console.log(`Claude Code base URL: http://127.0.0.1:${config.port}/anthropic`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
