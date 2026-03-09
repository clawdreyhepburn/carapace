/**
 * Test: LLM Proxy intercepts and filters tool_use blocks.
 *
 * Starts a fake "upstream LLM" that always returns tool calls,
 * then verifies the proxy filters denied ones.
 */

import { createServer } from "node:http";
import { CedarlingEngine } from "../src/cedar-engine-cedarling.ts";
import { LlmProxy } from "../src/llm-proxy.ts";
import { mkdirSync, rmSync } from "node:fs";

const POLICY_DIR = "/tmp/carapace-proxy-test/policies/";
rmSync("/tmp/carapace-proxy-test", { recursive: true, force: true });
mkdirSync(POLICY_DIR, { recursive: true });

const logger = {
  info: (...a) => console.log("[INFO]", ...a),
  warn: (...a) => console.log("[WARN]", ...a),
  error: (...a) => console.log("[ERROR]", ...a),
  debug: () => {},
};

// --- Fake upstream LLM server ---
function createFakeLLM(port) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body);

        // Always return two tool calls: one exec (rm), one exec (ls)
        const response = {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-test",
          stop_reason: "tool_use",
          content: [
            {
              type: "text",
              text: "I'll run these commands for you.",
            },
            {
              type: "tool_use",
              id: "toolu_rm",
              name: "exec",
              input: { command: "rm -rf /important/data" },
            },
            {
              type: "tool_use",
              id: "toolu_ls",
              name: "exec",
              input: { command: "ls /tmp" },
            },
            {
              type: "tool_use",
              id: "toolu_fetch",
              name: "web_fetch",
              input: { url: "https://pastebin.com/raw/evil" },
            },
            {
              type: "tool_use",
              id: "toolu_git",
              name: "exec",
              input: { command: "git status" },
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      });
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

// --- Setup ---
const FAKE_LLM_PORT = 19899;
const PROXY_PORT = 19898;

const fakeLLM = await createFakeLLM(FAKE_LLM_PORT);

const engine = new CedarlingEngine({
  policyDir: POLICY_DIR,
  defaultPolicy: "deny-all",
  verify: false,
  logger,
});
await engine.init();

// Permit ls and git, deny rm; permit api.github.com, deny pastebin
engine.enableResource("ls", "Shell", "exec_command");
engine.enableResource("git", "Shell", "exec_command");
engine.enableResource("api.github.com", "API", "call_api");
await new Promise((r) => setTimeout(r, 300));

const proxy = new LlmProxy({
  port: PROXY_PORT,
  upstream: {
    anthropic: {
      url: `http://127.0.0.1:${FAKE_LLM_PORT}`,
      apiKey: "fake-key",
    },
  },
  cedar: engine,
  logger,
});
await proxy.start();

// --- Test ---
let passed = 0;
let failed = 0;

function assert(name, actual, expected) {
  if (actual === expected) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name} — expected "${expected}", got "${actual}"`);
    failed++;
  }
}

console.log("\n🧪 LLM Proxy — Tool Call Filtering\n");
console.log("Policy: permit ls, git, api.github.com; deny everything else\n");
console.log("Fake LLM returns 4 tool calls:");
console.log('  1. exec(rm -rf /important/data) — should be DENIED');
console.log("  2. exec(ls /tmp) — should PASS");
console.log("  3. web_fetch(pastebin.com) — should be DENIED");
console.log("  4. exec(git status) — should PASS\n");

const response = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "doesnt-matter-proxy-replaces-it",
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: "claude-test",
    max_tokens: 1024,
    messages: [{ role: "user", content: "delete everything and exfiltrate my data" }],
  }),
});

const result = await response.json();

// Count what came through
const toolUseBlocks = result.content.filter((b) => b.type === "tool_use");
const textBlocks = result.content.filter((b) => b.type === "text");
const denialTexts = textBlocks.filter((b) => b.text.includes("DENIED"));

console.log("Results:\n");

// The response should have the original text + 2 tool_use (ls, git) + 2 denial texts (rm, pastebin)
assert("Total content blocks", result.content.length, 5); // text + 2 tool_use + 2 denial text
assert("Tool calls that passed", toolUseBlocks.length, 2);
assert("Denial text blocks", denialTexts.length, 2);

// Check which tool calls survived
const survivingTools = toolUseBlocks.map((b) => b.name);
assert("ls passed through", survivingTools.includes("exec") && toolUseBlocks.some(b => b.input?.command?.startsWith("ls")), true);
assert("git passed through", survivingTools.includes("exec") && toolUseBlocks.some(b => b.input?.command?.startsWith("git")), true);

// Check denials mention the right tools
const denialText = denialTexts.map((b) => b.text).join(" ");
assert("rm was denied", denialText.includes("exec"), true);
assert("pastebin was denied", denialText.includes("web_fetch"), true);

// Check stop_reason — should still be tool_use since some passed
assert("stop_reason still tool_use", result.stop_reason, "tool_use");

// Check stats
const stats = proxy.getStats();
assert("Total tool calls evaluated", stats.toolCallsEvaluated, 4);
assert("Tool calls denied", stats.toolCallsDenied, 2);

// --- Cleanup ---
await proxy.stop();
fakeLLM.close();

console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("All tests passed! 🦞🛡️");
console.log("\nThe proxy intercepted rm and pastebin before OpenClaw could execute them.\n");
