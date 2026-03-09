/**
 * End-to-end test: Block cp, try to copy a file, get denied.
 * Then allow cp, copy succeeds.
 * 
 * This simulates what happens when the agent calls carapace_exec.
 */

import { CedarlingEngine } from "../src/cedar-engine-cedarling.ts";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const POLICY_DIR = "/tmp/carapace-e2e-test/policies/";
const TEST_DIR = "/tmp/carapace-e2e-test/files/";

// Clean slate
rmSync("/tmp/carapace-e2e-test", { recursive: true, force: true });
mkdirSync(POLICY_DIR, { recursive: true });
mkdirSync(TEST_DIR, { recursive: true });

// Create a test file
writeFileSync(`${TEST_DIR}/secret.txt`, "TOP SECRET: launch codes 12345");

const logger = {
  info: (...a) => console.log("[INFO]", ...a),
  warn: (...a) => console.log("[WARN]", ...a),
  error: (...a) => console.log("[ERROR]", ...a),
  debug: () => {},
};

const engine = new CedarlingEngine({
  policyDir: POLICY_DIR,
  defaultPolicy: "deny-all",
  verify: false,
  logger,
});

await engine.init();

/** Simulate what carapace_exec does */
async function carapaceExec(command) {
  const binary = command.trim().split(/\s+/)[0].replace(/^.*\//, "");
  
  const decision = await engine.authorize({
    principal: 'Agent::"openclaw"',
    action: 'Action::"exec_command"',
    resource: `Shell::"${binary}"`,
    context: { args: command, workdir: "" },
  });

  if (decision.decision === "deny") {
    return {
      denied: true,
      message: `🚫 DENIED by Cedar policy: "${binary}"\nFull command: ${command}\nReason: ${decision.reasons.join(", ") || "default deny"}`,
    };
  }

  try {
    const result = execSync(command, { encoding: "utf-8", timeout: 5000 });
    return { denied: false, output: result };
  } catch (err) {
    return { denied: false, output: err.stdout ?? err.stderr ?? err.message, error: true };
  }
}

// --- Scenario 1: Try to copy with no permissions ---
console.log("═══════════════════════════════════════════");
console.log("  🦞 Carapace Shell Gating — Live Demo");
console.log("═══════════════════════════════════════════");

console.log("\n📋 Policy: deny-all (no permits)");
console.log("📁 File exists: secret.txt\n");

console.log("▶ Attempting: cp secret.txt stolen.txt");
let result = await carapaceExec(`cp ${TEST_DIR}/secret.txt ${TEST_DIR}/stolen.txt`);
console.log(result.denied ? result.message : `Output: ${result.output}`);
console.log(`📁 stolen.txt exists? ${existsSync(`${TEST_DIR}/stolen.txt`) ? "YES ⚠️" : "NO ✅"}`);

// --- Scenario 2: Allow ls but not cp ---
console.log("\n─────────────────────────────────────────");
console.log("📋 Adding permit for 'ls' only\n");
engine.enableResource("ls", "Shell", "exec_command");
await new Promise(r => setTimeout(r, 200));

console.log("▶ Attempting: ls (should work)");
result = await carapaceExec(`ls ${TEST_DIR}`);
console.log(result.denied ? result.message : `Output: ${result.output.trim()}`);

console.log("\n▶ Attempting: cp secret.txt stolen.txt (should fail)");
result = await carapaceExec(`cp ${TEST_DIR}/secret.txt ${TEST_DIR}/stolen.txt`);
console.log(result.denied ? result.message : `Output: ${result.output}`);
console.log(`📁 stolen.txt exists? ${existsSync(`${TEST_DIR}/stolen.txt`) ? "YES ⚠️" : "NO ✅"}`);

// --- Scenario 3: Allow cp too ---
console.log("\n─────────────────────────────────────────");
console.log("📋 Adding permit for 'cp'\n");
engine.enableResource("cp", "Shell", "exec_command");
await new Promise(r => setTimeout(r, 200));

console.log("▶ Attempting: cp secret.txt stolen.txt (should work now)");
result = await carapaceExec(`cp ${TEST_DIR}/secret.txt ${TEST_DIR}/stolen.txt`);
console.log(result.denied ? result.message : `✅ Copy succeeded`);
console.log(`📁 stolen.txt exists? ${existsSync(`${TEST_DIR}/stolen.txt`) ? "YES ✅" : "NO ⚠️"}`);
if (existsSync(`${TEST_DIR}/stolen.txt`)) {
  console.log(`📄 Contents: ${readFileSync(`${TEST_DIR}/stolen.txt`, "utf-8")}`);
}

// --- Scenario 4: Revoke cp with forbid ---
console.log("\n─────────────────────────────────────────");
console.log("📋 Adding FORBID for 'cp' (overrides permit)\n");
engine.disableResource("cp", "Shell", "exec_command");
await new Promise(r => setTimeout(r, 200));

// Clean up the copied file
rmSync(`${TEST_DIR}/stolen.txt`, { force: true });

console.log("▶ Attempting: cp secret.txt stolen.txt (should be denied again)");
result = await carapaceExec(`cp ${TEST_DIR}/secret.txt ${TEST_DIR}/stolen.txt`);
console.log(result.denied ? result.message : `Output: ${result.output}`);
console.log(`📁 stolen.txt exists? ${existsSync(`${TEST_DIR}/stolen.txt`) ? "YES ⚠️" : "NO ✅"}`);

console.log("\n═══════════════════════════════════════════");
console.log("  Demo complete. The carapace held. 🦞🛡️");
console.log("═══════════════════════════════════════════\n");
