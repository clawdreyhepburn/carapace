import { describe, it, expect, afterEach } from "vitest";
import { AgentContextManager } from "../src/agent-context.js";

/** Helper to create a minimal OVID JWT (unsigned, just for testing) */
function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "ovid+jwt" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = Buffer.from("fake-signature").toString("base64url");
  return `${header}.${payload}.${sig}`;
}

describe("AgentContextManager", () => {
  let manager: AgentContextManager;

  afterEach(() => {
    manager?.destroy();
  });

  it("registers an agent from a valid OVID JWT", () => {
    manager = new AgentContextManager();
    const jwt = makeJwt({
      sub: "clawdrey/reviewer-abc",
      iss: "clawdrey",
      role: "code-reviewer",
      parent_chain: ["sarah", "clawdrey"],
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    });

    const reg = manager.registerAgent(jwt);
    expect(reg.agent.agentId).toBe("clawdrey/reviewer-abc");
    expect(reg.agent.role).toBe("code-reviewer");
    expect(reg.agent.parentChain).toEqual(["sarah", "clawdrey"]);
    expect(reg.agent.issuer).toBe("clawdrey");
    expect(reg.agent.depth).toBe(2);
    expect(reg.agent.attestationProven).toBe(false);
  });

  it("retrieves a registered agent", () => {
    manager = new AgentContextManager();
    const jwt = makeJwt({
      sub: "test-agent",
      iss: "parent",
      role: "worker",
      parent_chain: ["parent"],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    manager.registerAgent(jwt);
    const ctx = manager.getAgentContext("test-agent");
    expect(ctx).not.toBeNull();
    expect(ctx!.role).toBe("worker");
  });

  it("returns null for unknown agent", () => {
    manager = new AgentContextManager();
    expect(manager.getAgentContext("nonexistent")).toBeNull();
  });

  it("rejects expired JWTs", () => {
    manager = new AgentContextManager();
    const jwt = makeJwt({
      sub: "expired-agent",
      iss: "parent",
      role: "worker",
      parent_chain: [],
      exp: Math.floor(Date.now() / 1000) - 100, // expired
    });

    expect(() => manager.registerAgent(jwt)).toThrow(/expired/i);
  });

  it("rejects JWTs missing required claims", () => {
    manager = new AgentContextManager();
    const jwt = makeJwt({ sub: "no-role" });
    expect(() => manager.registerAgent(jwt)).toThrow(/missing required claims/i);
  });

  it("evicts expired agents", () => {
    manager = new AgentContextManager();
    const jwt = makeJwt({
      sub: "short-lived",
      iss: "parent",
      role: "worker",
      parent_chain: [],
      exp: Math.floor(Date.now() / 1000) - 1, // already expired (just barely)
    });

    // Directly insert an already-expired agent for testing eviction
    const reg = {
      agentId: "short-lived",
      role: "worker",
      parentChain: [],
      issuer: "parent",
      depth: 0,
      registeredAt: Date.now() - 60000,
      expiresAt: Date.now() - 1000, // expired
      attestationProven: false,
    };
    // Access internal map via getAll + evictExpired
    (manager as any).agents.set("short-lived", reg);

    expect(manager.getAll().length).toBe(0); // getAll calls evictExpired
  });

  it("updates attestation status", () => {
    manager = new AgentContextManager();
    const jwt = makeJwt({
      sub: "attest-agent",
      iss: "parent",
      role: "coder",
      parent_chain: ["parent"],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    manager.registerAgent(jwt);
    expect(manager.getAgentContext("attest-agent")!.attestationProven).toBe(false);

    manager.setAttestationProven("attest-agent", true);
    expect(manager.getAgentContext("attest-agent")!.attestationProven).toBe(true);
  });
});
