import { describe, it, expect } from "vitest";
import { CedarEngine } from "../src/cedar-engine.js";
import type { AgentContextForCedar } from "../src/types.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Three-valued authorization decisions", () => {
  let policyDir: string;

  function makePolicyDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "carapace-test-"));
    return dir;
  }

  async function makeEngine(defaultPolicy: "allow-all" | "deny-all" = "allow-all") {
    policyDir = makePolicyDir();
    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    const engine = new CedarEngine({
      policyDir,
      defaultPolicy,
      verify: false,
      logger,
    });
    await engine.init();
    return engine;
  }

  it("returns basic allow decision without agent context", async () => {
    const engine = await makeEngine("allow-all");
    const decision = await engine.authorizeWithDecision!({
      principal: 'Agent::"openclaw"',
      action: 'Action::"call_tool"',
      resource: 'Tool::"github/create_issue"',
    });

    expect(decision.decision).toBe("allow");
    expect(decision.attestation).toBeUndefined(); // no agent = no attestation
    expect(decision.agent).toBeUndefined();
    rmSync(policyDir, { recursive: true });
  });

  it("returns allow+unproven when agent context is present but not proven", async () => {
    const engine = await makeEngine("allow-all");
    const agentCtx: AgentContextForCedar = {
      agentId: "clawdrey/reviewer-123",
      role: "code-reviewer",
      parentChain: ["sarah", "clawdrey"],
      issuer: "clawdrey",
      depth: 2,
      attestationProven: false,
    };

    const decision = await engine.authorizeWithDecision!({
      principal: 'Agent::"openclaw"',
      action: 'Action::"call_tool"',
      resource: 'Tool::"github/create_issue"',
    }, agentCtx);

    expect(decision.decision).toBe("allow");
    expect(decision.attestation).toBe("unproven");
    expect(decision.agent?.agentId).toBe("clawdrey/reviewer-123");
    expect(decision.agent?.role).toBe("code-reviewer");
    expect(decision.agent?.depth).toBe(2);
    rmSync(policyDir, { recursive: true });
  });

  it("returns allow+proven when agent context is proven", async () => {
    const engine = await makeEngine("allow-all");
    const agentCtx: AgentContextForCedar = {
      agentId: "clawdrey/coder-456",
      role: "coder",
      parentChain: ["clawdrey"],
      issuer: "clawdrey",
      depth: 1,
      attestationProven: true,
    };

    const decision = await engine.authorizeWithDecision!({
      principal: 'Agent::"openclaw"',
      action: 'Action::"call_tool"',
      resource: 'Tool::"github/create_issue"',
    }, agentCtx);

    expect(decision.decision).toBe("allow");
    expect(decision.attestation).toBe("proven");
    rmSync(policyDir, { recursive: true });
  });

  it("returns deny with no attestation when forbidden", async () => {
    const engine = await makeEngine("deny-all");
    const agentCtx: AgentContextForCedar = {
      agentId: "clawdrey/bad-actor",
      role: "admin",
      parentChain: [],
      issuer: "unknown",
      depth: 0,
      attestationProven: true,
    };

    const decision = await engine.authorizeWithDecision!({
      principal: 'Agent::"openclaw"',
      action: 'Action::"call_tool"',
      resource: 'Tool::"github/delete_repo"',
    }, agentCtx);

    expect(decision.decision).toBe("deny");
    expect(decision.attestation).toBeUndefined(); // deny = no attestation
    rmSync(policyDir, { recursive: true });
  });

  it("backwards compatible: no agent context works as before", async () => {
    const engine = await makeEngine("allow-all");
    // Old-style authorize (no agent context)
    const cedarDecision = await engine.authorize({
      principal: 'Agent::"openclaw"',
      action: 'Action::"call_tool"',
      resource: 'Tool::"some/tool"',
    });

    expect(cedarDecision.decision).toBe("allow");
    expect(cedarDecision.reasons.length).toBeGreaterThan(0);
    rmSync(policyDir, { recursive: true });
  });
});
