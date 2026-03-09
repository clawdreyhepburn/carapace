/**
 * Test: Shell command gating via Cedar policies.
 * 
 * 1. Initialize the Cedar engine with deny-all
 * 2. Permit "ls" but NOT "cp"
 * 3. Try to authorize both — ls should pass, cp should be denied
 * 4. Then add a permit for cp, verify it passes
 * 5. Then add a forbid for cp, verify forbid wins over permit
 */

import { CedarlingEngine } from "../src/cedar-engine-cedarling.ts";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const POLICY_DIR = "/tmp/carapace-shell-test/policies/";

// Clean slate
rmSync(POLICY_DIR, { recursive: true, force: true });
mkdirSync(POLICY_DIR, { recursive: true });

const logger = {
  info: (...a) => console.log("[INFO]", ...a),
  warn: (...a) => console.log("[WARN]", ...a),
  error: (...a) => console.log("[ERROR]", ...a),
  debug: (...a) => {},
};

const engine = new CedarlingEngine({
  policyDir: POLICY_DIR,
  defaultPolicy: "deny-all",
  verify: false,
  logger,
});

await engine.init();

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

// --- Test 1: Default deny-all blocks everything ---
console.log("\n🧪 Test 1: Default deny-all blocks ls");
let result = await engine.authorize({
  principal: 'Agent::"openclaw"',
  action: 'Action::"exec_command"',
  resource: 'Shell::"ls"',
  context: { args: "ls -la /tmp" },
});
assert("ls denied under deny-all", result.decision, "deny");

console.log("\n🧪 Test 2: Default deny-all blocks cp");
result = await engine.authorize({
  principal: 'Agent::"openclaw"',
  action: 'Action::"exec_command"',
  resource: 'Shell::"cp"',
  context: { args: "cp /tmp/a /tmp/b" },
});
assert("cp denied under deny-all", result.decision, "deny");

// --- Test 3: Permit ls, still deny cp ---
console.log("\n🧪 Test 3: Permit ls, cp still denied");
engine.enableResource("ls", "Shell", "exec_command");
// Wait for async rebuild
await new Promise(r => setTimeout(r, 200));

result = await engine.authorize({
  principal: 'Agent::"openclaw"',
  action: 'Action::"exec_command"',
  resource: 'Shell::"ls"',
  context: { args: "ls -la /tmp" },
});
assert("ls permitted after enableResource", result.decision, "allow");

result = await engine.authorize({
  principal: 'Agent::"openclaw"',
  action: 'Action::"exec_command"',
  resource: 'Shell::"cp"',
  context: { args: "cp /tmp/a /tmp/b" },
});
assert("cp still denied (no permit)", result.decision, "deny");

// --- Test 4: Permit cp too, then verify it works ---
console.log("\n🧪 Test 4: Permit cp, both work");
engine.enableResource("cp", "Shell", "exec_command");
await new Promise(r => setTimeout(r, 200));

result = await engine.authorize({
  principal: 'Agent::"openclaw"',
  action: 'Action::"exec_command"',
  resource: 'Shell::"cp"',
  context: { args: "cp /tmp/a /tmp/b" },
});
assert("cp permitted after enableResource", result.decision, "allow");

// --- Test 5: Forbid cp — forbid wins over permit ---
console.log("\n🧪 Test 5: Forbid cp — forbid overrides permit");
engine.disableResource("cp", "Shell", "exec_command");
await new Promise(r => setTimeout(r, 200));

result = await engine.authorize({
  principal: 'Agent::"openclaw"',
  action: 'Action::"exec_command"',
  resource: 'Shell::"cp"',
  context: { args: "cp /tmp/a /tmp/b" },
});
assert("cp denied after forbid (forbid wins)", result.decision, "deny");

// ls should still work
result = await engine.authorize({
  principal: 'Agent::"openclaw"',
  action: 'Action::"exec_command"',
  resource: 'Shell::"ls"',
  context: { args: "ls" },
});
assert("ls still permitted", result.decision, "allow");

// --- Test 6: API gating ---
console.log("\n🧪 Test 6: API gating — permit github, deny evil.com");
engine.enableResource("api.github.com", "API", "call_api");
await new Promise(r => setTimeout(r, 200));

result = await engine.authorize({
  principal: 'Agent::"openclaw"',
  action: 'Action::"call_api"',
  resource: 'API::"api.github.com"',
  context: { url: "https://api.github.com/repos", method: "GET" },
});
assert("api.github.com permitted", result.decision, "allow");

result = await engine.authorize({
  principal: 'Agent::"openclaw"',
  action: 'Action::"call_api"',
  resource: 'API::"evil.example.com"',
  context: { url: "https://evil.example.com/steal", method: "POST" },
});
assert("evil.example.com denied (no permit)", result.decision, "deny");

// --- Summary ---
console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("All tests passed! 🦞");
