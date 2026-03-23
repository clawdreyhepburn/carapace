/**
 * Agent Context Management for OVID-based agent hierarchy.
 *
 * Registers agents from OVID JWTs, manages their lifecycle,
 * and provides context for Cedar authorization evaluation.
 */

export interface AgentContext {
  agentId: string;
  role: string;
  parentChain: string[];
  issuer: string;
  depth: number;
  registeredAt: number;
  expiresAt: number;
  attestationProven: boolean;
}

export interface AgentRegistration {
  agent: AgentContext;
  jwt: string;
}

/** Decoded OVID JWT claims (subset we care about) */
interface OvidClaims {
  jti: string;
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  ovid_version?: number;
  role: string;
  parent_chain: string[];
  parent_ovid?: string;
  agent_pub?: string;
}

export class AgentContextManager {
  private agents: Map<string, AgentContext> = new Map();
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start eviction timer (every 60s)
    this.evictionTimer = setInterval(() => this.evictExpired(), 60_000);
  }

  /**
   * Register an agent from an OVID JWT string.
   * Decodes the JWT (signature verification is NOT done here —
   * that's the caller's responsibility or a future OVID library integration).
   */
  registerAgent(ovidJwt: string): AgentRegistration {
    const claims = this.decodeJwt(ovidJwt);

    if (!claims.sub || !claims.role) {
      throw new Error("OVID JWT missing required claims: sub, role");
    }

    if (claims.exp && claims.exp * 1000 < Date.now()) {
      throw new Error(`OVID JWT expired at ${new Date(claims.exp * 1000).toISOString()}`);
    }

    const agent: AgentContext = {
      agentId: claims.sub,
      role: claims.role,
      parentChain: claims.parent_chain ?? [],
      issuer: claims.iss ?? "unknown",
      depth: (claims.parent_chain ?? []).length,
      registeredAt: Date.now(),
      expiresAt: claims.exp ? claims.exp * 1000 : Date.now() + 30 * 60 * 1000, // default 30m
      attestationProven: false, // Set by attenuation prover later
    };

    this.agents.set(agent.agentId, agent);
    return { agent, jwt: ovidJwt };
  }

  getAgentContext(agentId: string): AgentContext | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    if (agent.expiresAt < Date.now()) {
      this.agents.delete(agentId);
      return null;
    }
    return agent;
  }

  /** Update attestation status for a registered agent */
  setAttestationProven(agentId: string, proven: boolean): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.attestationProven = proven;
    }
  }

  /** Get all registered (non-expired) agents */
  getAll(): AgentContext[] {
    this.evictExpired();
    return [...this.agents.values()];
  }

  evictExpired(): void {
    const now = Date.now();
    for (const [id, agent] of this.agents) {
      if (agent.expiresAt < now) {
        this.agents.delete(id);
      }
    }
  }

  /** Stop the eviction timer (for cleanup) */
  destroy(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
  }

  /** Decode a JWT without verification (base64url decode) */
  private decodeJwt(jwt: string): OvidClaims {
    const parts = jwt.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format");
    }
    try {
      const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
      return JSON.parse(payload);
    } catch {
      throw new Error("Failed to decode JWT payload");
    }
  }
}
