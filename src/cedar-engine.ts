/**
 * Cedar policy engine for MCP tool authorization.
 *
 * Manages Cedar policies, evaluates authorization requests,
 * and optionally verifies policies with cvc5.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import type { Logger, AuthzRequest, CedarDecision, VerifyResult, CedarSchemaInfo, SchemaEntity, SchemaAttribute, SchemaAction } from "./types.js";

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

  /** Save or update a policy by id */
  savePolicy(id: string, raw: string): void {
    const effect = raw.trimStart().startsWith("forbid") ? "forbid" as const : "permit" as const;
    const principalMatch = raw.match(/principal\s*==\s*([^\s,)]+)/);
    const actionMatch = raw.match(/action\s*==\s*([^\s,)]+)/);
    const resourceMatch = raw.match(/resource\s*==\s*([^\s,)]+)/);

    this.writePolicy(id, raw);
    this.policies.set(id, {
      id,
      effect,
      principal: principalMatch?.[1],
      action: actionMatch?.[1],
      resource: resourceMatch?.[1],
      raw,
    });
    this.logger.info(`Saved policy: ${id}`);
    if (this.shouldVerify) this.verify().catch(() => {});
  }

  /** Delete a policy by id */
  deletePolicy(id: string): boolean {
    if (!this.policies.has(id)) return false;
    this.removePolicy(id);
    this.logger.info(`Deleted policy: ${id}`);
    return true;
  }

  /** Get the parsed Cedar schema for the policy builder GUI */
  getSchema(): CedarSchemaInfo {
    if (!existsSync(this.schemaPath)) {
      return { entities: [], actions: [], raw: "" };
    }
    const raw = readFileSync(this.schemaPath, "utf-8");
    return {
      ...this.parseSchemaForGui(raw),
      raw,
    };
  }

  /** Update the schema from the GUI */
  saveSchema(raw: string): void {
    writeFileSync(this.schemaPath, raw, "utf-8");
    this.logger.info("Schema updated");
  }

  /**
   * Regenerate schema from discovered MCP tools.
   * Creates entity types for each server and tool entries.
   */
  regenerateSchema(tools: Array<{ qualifiedName: string; server: string; name: string; inputSchema?: any }>): void {
    const servers = new Set(tools.map(t => t.server));
    const toolNames = tools.map(t => `"${t.qualifiedName}"`);

    let schema = `namespace McpProxy {\n`;
    schema += `  entity Agent;\n`;
    schema += `  entity Server;\n`;
    schema += `  entity Tool in [Server] {\n`;
    schema += `    server: String,\n`;
    schema += `    name: String\n`;
    schema += `  };\n\n`;

    schema += `  action "call_tool" appliesTo {\n`;
    schema += `    principal: Agent,\n`;
    schema += `    resource: Tool,\n`;
    schema += `    context: {\n`;
    schema += `      arguments?: Record\n`;
    schema += `    }\n`;
    schema += `  };\n\n`;

    schema += `  action "list_tools" appliesTo {\n`;
    schema += `    principal: Agent,\n`;
    schema += `    resource: Tool\n`;
    schema += `  };\n`;
    schema += `}\n`;

    writeFileSync(this.schemaPath, schema, "utf-8");
    this.logger.info(`Schema regenerated with ${tools.length} tools from ${servers.size} servers`);
  }

  private parseSchemaForGui(raw: string): { entities: SchemaEntity[]; actions: SchemaAction[] } {
    const entities: SchemaEntity[] = [];
    const actions: SchemaAction[] = [];

    // Parse entity declarations
    const entityRe = /entity\s+(\w+)(?:\s+in\s+\[([^\]]+)\])?\s*(?:\{([^}]*)\})?/g;
    let m;
    while ((m = entityRe.exec(raw)) !== null) {
      const attrs: SchemaAttribute[] = [];
      if (m[3]) {
        const attrRe = /(\w+)\??:\s*(\w+)/g;
        let am;
        while ((am = attrRe.exec(m[3])) !== null) {
          attrs.push({ name: am[1], type: am[2], optional: m[3].includes(am[1] + "?") });
        }
      }
      entities.push({ name: m[1], parents: m[2]?.split(",").map(s => s.trim()) ?? [], attributes: attrs });
    }

    // Parse action declarations
    const actionRe = /action\s+"([^"]+)"\s+appliesTo\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
    while ((m = actionRe.exec(raw)) !== null) {
      const body = m[2];
      const principalMatch = body.match(/principal:\s*(\w+)/);
      const resourceMatch = body.match(/resource:\s*(\w+)/);
      actions.push({
        name: m[1],
        principalTypes: principalMatch ? [principalMatch[1]] : [],
        resourceTypes: resourceMatch ? [resourceMatch[1]] : [],
      });
    }

    return { entities, actions };
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
