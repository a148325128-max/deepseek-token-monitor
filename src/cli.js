const { loadConfig } = require("./config");
const { EventStore } = require("./store");
const { runDoctor } = require("./doctor");

async function main() {
  const command = process.argv[2];
  const config = loadConfig();
  const store = new EventStore(config.dataDir);
  if (command === "doctor") {
    console.log(JSON.stringify(await runDoctor({ store, config }), null, 2));
    return;
  }
  console.error("Usage: node src/cli.js doctor");
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
