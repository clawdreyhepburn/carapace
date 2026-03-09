/**
 * Cedar policy engine for MCP tool authorization.
 *
 * Manages Cedar policies, evaluates authorization requests,
 * and optionally verifies policies with cvc5.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import type { Logger, AuthzRequest, CedarDecision, VerifyResult } from "./types.js";

interface CedarEngineOpts {
  policyDir: string;
  defaultPolicy: "deny-all" | "allow-all";
  verify: boolean;
  logger: Logger;
}

/** In-memory Cedar policy representation */
interface Policy {
  id: string;
  effect: "permit" | "forbid";
  principal?: string;
  action?: string;
  resource?: string;
  conditions?: string;
  raw: string;
}

export class CedarEngine {
  private policyDir: string;
  private defaultPolicy: "deny-all" | "allow-all";
  private shouldVerify: boolean;
  private logger: Logger;
  private policies: Map<string, Policy> = new Map();
  private schemaPath: string;

  constructor(opts: CedarEngineOpts) {
    this.policyDir = opts.policyDir.replace("~", homedir());
    this.defaultPolicy = opts.defaultPolicy;
    this.shouldVerify = opts.verify;
    this.logger = opts.logger;
    this.schemaPath = join(this.policyDir, "schema.cedarschema");
  }

  async init(): Promise<void> {
    // Ensure policy directory exists
    mkdirSync(this.policyDir, { recursive: true });

    // Generate default schema if none exists
    if (!existsSync(this.schemaPath)) {
      this.writeDefaultSchema();
    }

    // Load existing policies
    this.loadPolicies();

    // Write default policy if none exist
    if (this.policies.size === 0) {
      this.writeDefaultPolicies();
      this.loadPolicies();
    }

    this.logger.info(`Cedar engine initialized: ${this.policies.size} policies loaded from ${this.policyDir}`);
  }

  /**
   * Evaluate an authorization request against loaded policies.
   * Uses Cedar's evaluation semantics: ALLOW requires at least one permit and no forbids.
   */
  async authorize(request: AuthzRequest): Promise<CedarDecision> {
    const reasons: string[] = [];
    let hasPermit = false;
    let hasForbid = false;

    for (const [id, policy] of this.policies) {
      if (!this.policyMatches(policy, request)) continue;

      if (policy.effect === "forbid") {
        hasForbid = true;
        reasons.push(`forbid: ${id}`);
      } else if (policy.effect === "permit") {
        hasPermit = true;
        reasons.push(`permit: ${id}`);
      }
    }

    // Cedar semantics: forbid always wins, then need at least one permit
    if (hasForbid) {
      return { decision: "deny", reasons };
    }
    if (hasPermit) {
      return { decision: "allow", reasons };
    }

    // Default deny (no matching policies)
    return { decision: "deny", reasons: ["no matching permit policy"] };
  }

  /**
   * Enable a tool by writing a permit policy.
   */
  enableTool(qualifiedName: string): void {
    const policyId = `tool-enable-${qualifiedName.replace(/\//g, "-")}`;
    const raw = `permit(
  principal == Agent::"openclaw",
  action == Action::"call_tool",
  resource == Tool::"${qualifiedName}"
);`;

    // Remove any disable policy
    const disableId = `tool-disable-${qualifiedName.replace(/\//g, "-")}`;
    this.removePolicy(disableId);

    this.writePolicy(policyId, raw);
    this.policies.set(policyId, {
      id: policyId,
      effect: "permit",
      principal: 'Agent::"openclaw"',
      action: 'Action::"call_tool"',
      resource: `Tool::"${qualifiedName}"`,
      raw,
    });

    this.logger.info(`Enabled tool: ${qualifiedName}`);
    if (this.shouldVerify) this.verify().catch(() => {});
  }

  /**
   * Disable a tool by writing a forbid policy.
   */
  disableTool(qualifiedName: string): void {
    const policyId = `tool-disable-${qualifiedName.replace(/\//g, "-")}`;
    const raw = `forbid(
  principal,
  action == Action::"call_tool",
  resource == Tool::"${qualifiedName}"
);`;

    // Remove any enable policy
    const enableId = `tool-enable-${qualifiedName.replace(/\//g, "-")}`;
    this.removePolicy(enableId);

    this.writePolicy(policyId, raw);
    this.policies.set(policyId, {
      id: policyId,
      effect: "forbid",
      action: 'Action::"call_tool"',
      resource: `Tool::"${qualifiedName}"`,
      raw,
    });

    this.logger.info(`Disabled tool: ${qualifiedName}`);
    if (this.shouldVerify) this.verify().catch(() => {});
  }

  /**
   * Check if a tool is enabled (has a matching permit and no matching forbid).
   */
  isToolEnabled(qualifiedName: string): boolean {
    const request: AuthzRequest = {
      principal: 'Agent::"openclaw"',
      action: 'Action::"call_tool"',
      resource: `Tool::"${qualifiedName}"`,
    };

    // Synchronous check — fine for GUI rendering
    let hasPermit = false;
    let hasForbid = false;
    for (const policy of this.policies.values()) {
      if (!this.policyMatches(policy, request)) continue;
      if (policy.effect === "forbid") hasForbid = true;
      if (policy.effect === "permit") hasPermit = true;
    }
    return hasPermit && !hasForbid;
  }

  /**
   * Run formal verification with cvc5 (if available).
   */
  async verify(): Promise<VerifyResult> {
    const start = Date.now();

    // Check if cedar CLI is available
    const cedarBin = process.env.CEDAR_CLI ?? "cedar";
    try {
      execFileSync("which", [cedarBin], { encoding: "utf-8" });
    } catch {
      return {
        ok: true,
        issues: ["cedar CLI not found — skipping verification"],
        durationMs: Date.now() - start,
      };
    }

    // For now, validate policies parse correctly
    // TODO: Full cvc5 symbolic verification pipeline
    const issues: string[] = [];
    try {
      const allPolicies = [...this.policies.values()].map((p) => p.raw).join("\n\n");
      const tmpPolicy = join(this.policyDir, ".verify-tmp.cedar");
      writeFileSync(tmpPolicy, allPolicies);

      execFileSync(cedarBin, ["validate", "--schema", this.schemaPath, "--policies", tmpPolicy], {
        encoding: "utf-8",
      });
    } catch (err: any) {
      issues.push(err.message ?? "validation failed");
    }

    return {
      ok: issues.length === 0,
      issues,
      durationMs: Date.now() - start,
    };
  }

  /** Get all policies as raw text */
  getPolicies(): Array<{ id: string; effect: string; raw: string }> {
    return [...this.policies.values()].map((p) => ({
      id: p.id,
      effect: p.effect,
      raw: p.raw,
    }));
  }

  // --- Private ---

  private policyMatches(policy: Policy, request: AuthzRequest): boolean {
    if (policy.principal && policy.principal !== request.principal) return false;
    if (policy.action && policy.action !== request.action) return false;
    if (policy.resource && policy.resource !== request.resource) return false;
    return true;
  }

  private loadPolicies(): void {
    this.policies.clear();
    if (!existsSync(this.policyDir)) return;

    for (const file of readdirSync(this.policyDir)) {
      if (!file.endsWith(".cedar")) continue;
      const path = join(this.policyDir, file);
      const raw = readFileSync(path, "utf-8");
      const id = file.replace(".cedar", "");

      // Simple parser for our generated policies
      const effect = raw.trimStart().startsWith("forbid") ? "forbid" : "permit";
      const principalMatch = raw.match(/principal\s*==\s*([^\s,)]+)/);
      const actionMatch = raw.match(/action\s*==\s*([^\s,)]+)/);
      const resourceMatch = raw.match(/resource\s*==\s*([^\s,)]+)/);

      this.policies.set(id, {
        id,
        effect,
        principal: principalMatch?.[1],
        action: actionMatch?.[1],
        resource: resourceMatch?.[1],
        raw,
      });
    }
  }

  private writePolicy(id: string, raw: string): void {
    const path = join(this.policyDir, `${id}.cedar`);
    writeFileSync(path, raw, "utf-8");
  }

  private removePolicy(id: string): void {
    const path = join(this.policyDir, `${id}.cedar`);
    if (existsSync(path)) {
      const { unlinkSync } = require("node:fs");
      unlinkSync(path);
    }
    this.policies.delete(id);
  }

  private writeDefaultSchema(): void {
    const schema = `namespace McpProxy {
  entity Agent;
  entity Tool;

  action "call_tool" appliesTo {
    principal: Agent,
    resource: Tool,
    context: {
      arguments?: Record
    }
  };

  action "list_tools" appliesTo {
    principal: Agent,
    resource: Tool
  };
}
`;
    writeFileSync(this.schemaPath, schema, "utf-8");
    this.logger.info("Created default Cedar schema");
  }

  private writeDefaultPolicies(): void {
    if (this.defaultPolicy === "allow-all") {
      this.writePolicy("default-allow", `permit(
  principal == Agent::"openclaw",
  action == Action::"call_tool",
  resource
);`);
    }
    // deny-all needs no explicit policy — Cedar default-denies
  }
}
