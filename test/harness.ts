/**
 * Standalone test harness — runs the MCP Cedar Proxy outside OpenClaw
 * so we can test the GUI and Cedar enforcement end-to-end.
 */

import { CedarlingEngine } from "../src/cedar-engine-cedarling.js";
import { McpAggregator } from "../src/mcp-aggregator.js";
import { ControlGui } from "../src/gui/server.js";

const logger = {
  info: (msg: string, ...args: any[]) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.log(`[WARN] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.log(`[ERROR] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.log(`[DEBUG] ${msg}`, ...args),
};

const POLICY_DIR = "/tmp/mcp-cedar-proxy-test/policies";
const PORT = 19820;

async function main() {
  console.log("=== MCP Cedar Proxy Test Harness ===\n");

  // Clean slate
  const { execSync } = await import("node:child_process");
  execSync(`rm -rf /tmp/mcp-cedar-proxy-test`);

  const cedar = new CedarlingEngine({
    policyDir: POLICY_DIR,
    defaultPolicy: "deny-all",
    verify: false,
    logger,
  });

  const aggregator = new McpAggregator({
    servers: {
      "filesystem": {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/mcp-cedar-proxy-test/sandbox"],
      },
      "everything": {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
      },
    },
    cedar,
    logger,
  });

  const gui = new ControlGui({
    port: PORT,
    aggregator,
    cedar,
    logger,
  });

  // Create sandbox dir for filesystem server
  execSync(`mkdir -p /tmp/mcp-cedar-proxy-test/sandbox`);
  execSync(`echo "hello world" > /tmp/mcp-cedar-proxy-test/sandbox/test.txt`);
  execSync(`echo '{"name":"test"}' > /tmp/mcp-cedar-proxy-test/sandbox/data.json`);

  await cedar.init();
  console.log("\n--- Connecting to MCP servers (may take a moment for npx) ---\n");
  await aggregator.connectAll();
  await gui.start();

  console.log(`\n✅ GUI running at http://127.0.0.1:${PORT}`);
  console.log(`\nDiscovered tools:`);
  for (const t of aggregator.listTools()) {
    console.log(`  ${t.enabled ? '🟢' : '🔴'} ${t.qualifiedName} — ${t.description}`);
  }

  // Also expose a simple API test endpoint
  console.log(`\n--- Test Cedar enforcement via curl ---`);
  console.log(`curl http://127.0.0.1:${PORT}/api/status | jq .`);
  console.log(`\nPress Ctrl+C to stop.\n`);

  // Keep alive
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await gui.stop();
    await aggregator.disconnectAll();
    process.exit(0);
  });
}

main().catch(console.error);
