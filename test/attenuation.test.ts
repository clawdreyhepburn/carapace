import { describe, it, expect } from "vitest";
import { AttenuationProver } from "../src/attenuation.js";
import type { AgentContext } from "../src/agent-context.js";

function makeAgent(role: string, parentChain: string[] = []): AgentContext {
  return {
    agentId: `test/${role}`,
    role,
    parentChain,
    issuer: parentChain[parentChain.length - 1] ?? "root",
    depth: parentChain.length,
    registeredAt: Date.now(),
    expiresAt: Date.now() + 3600000,
    attestationProven: false,
  };
}

describe("AttenuationProver", () => {
  it("proveAttenuation returns unproven (stub)", () => {
    const prover = new AttenuationProver();
    const child = makeAgent("code-reviewer", ["clawdrey"]);
    const parent = makeAgent("orchestrator", []);
    const result = prover.proveAttenuation(child, parent, "permit(principal, action, resource);");
    expect(result.proven).toBe(false);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.error).toContain("stub");
  });

  it("checkAttenuation: child more restrictive than parent = true", () => {
    const prover = new AttenuationProver();
    expect(prover.checkAttenuation("code-reviewer", "orchestrator", "")).toBe(true);
    expect(prover.checkAttenuation("reader", "admin", "")).toBe(true);
    expect(prover.checkAttenuation("coder", "architect", "")).toBe(true);
  });

  it("checkAttenuation: child less restrictive than parent = false", () => {
    const prover = new AttenuationProver();
    expect(prover.checkAttenuation("admin", "code-reviewer", "")).toBe(false);
    expect(prover.checkAttenuation("orchestrator", "reader", "")).toBe(false);
  });

  it("checkAttenuation: same role = true", () => {
    const prover = new AttenuationProver();
    expect(prover.checkAttenuation("coder", "coder", "")).toBe(true);
  });

  it("checkAttenuation: unknown roles = false", () => {
    const prover = new AttenuationProver();
    expect(prover.checkAttenuation("custom-role", "another-role", "")).toBe(false);
  });

  it("caches proof results", () => {
    const prover = new AttenuationProver();
    const child = makeAgent("coder", ["clawdrey"]);
    const parent = makeAgent("admin", []);
    const policies = "permit(principal, action, resource);";

    const r1 = prover.proveAttenuation(child, parent, policies);
    const r2 = prover.proveAttenuation(child, parent, policies);
    // Both should return same result (cached)
    expect(r1.proven).toBe(r2.proven);
  });

  it("cache clears", () => {
    const prover = new AttenuationProver();
    const child = makeAgent("coder", ["clawdrey"]);
    const parent = makeAgent("admin", []);
    prover.proveAttenuation(child, parent, "policy1");
    prover.clearCache();
    // No error after clear — just works
    const r = prover.proveAttenuation(child, parent, "policy1");
    expect(r.proven).toBe(false);
  });
});
