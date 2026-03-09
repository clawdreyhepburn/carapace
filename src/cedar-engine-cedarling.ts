/**
 * Cedarling-powered Cedar engine for MCP tool authorization.
 *
 * Uses Gluu's Cedarling WASM module for proper Cedar evaluation,
 * JWT validation, and the Policy Store format. Falls back to the
 * homebrew engine if WASM loading fails.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type {
  Logger,
  AuthzRequest,
  CedarDecision,
  VerifyResult,
  CedarSchemaInfo,
  SchemaEntity,
  SchemaAttribute,
  SchemaAction,
} from "./types.js";

// Cedarling WASM types (from @janssenproject/cedarling_wasm)
interface CedarlingInstance {
  authorize_unsigned(request: any): Promise<any>;
  pop_logs(): any[];
}

interface CedarlingWasm {
  initSync(opts: { module: Buffer }): void;
  init(config: any): Promise<CedarlingInstance>;
}

interface PolicyStoreEntry {
  description?: string;
  creation_date?: string;
  policy_content: string; // base64-encoded Cedar policy
}

interface PolicyStoreJson {
  cedar_version: string;
  policy_stores: {
    [id: string]: {
      name: string;
      description: string;
      policies: { [id: string]: PolicyStoreEntry };
      schema: string; // base64-encoded Cedar JSON schema
      trusted_issuers: Record<string, unknown>;
    };
  };
}

export interface CedarlingEngineOpts {
  policyDir: string;
  defaultPolicy: "deny-all" | "allow-all";
  verify: boolean;
  logger: Logger;
  namespace?: string; // Cedar namespace, default "Jans"
  agentEntityType?: string; // Principal entity type, default "Workload"
}

export class CedarlingEngine {
  private policyDir: string;
  private defaultPolicy: "deny-all" | "allow-all";
  private shouldVerify: boolean;
  private logger: Logger;
  private namespace: string;
  private agentEntityType: string;

  // Cedarling state
  private cedarling: CedarlingInstance | null = null;
  private wasmModule: CedarlingWasm | null = null;

  // Policy/schema storage (mirrors disk, used to rebuild policy store)
  private policies: Map<string, { effect: string; raw: string }> = new Map();
  private schemaJson: any = null;
  private schemaRaw: string = "";

  constructor(opts: CedarlingEngineOpts) {
    this.policyDir = opts.policyDir.replace("~", homedir());
    this.defaultPolicy = opts.defaultPolicy;
    this.shouldVerify = opts.verify;
    this.logger = opts.logger;
    this.namespace = opts.namespace ?? "Jans";
    this.agentEntityType = opts.agentEntityType ?? "Workload";
  }

  async init(): Promise<void> {
    mkdirSync(this.policyDir, { recursive: true });

    // Try to load Cedarling WASM
    try {
      await this.loadWasm();
    } catch (err: any) {
      this.logger.warn(`Cedarling WASM not available, falling back to basic engine: ${err.message}`);
    }

    // Load existing policies from disk
    this.loadPoliciesFromDisk();

    // Generate default schema if none exists
    const schemaPath = join(this.policyDir, "schema.json");
    if (!existsSync(schemaPath)) {
      this.writeDefaultSchema();
    }
    this.schemaRaw = readFileSync(schemaPath, "utf-8");
    try {
      this.schemaJson = JSON.parse(this.schemaRaw);
    } catch {
      this.logger.warn("Failed to parse schema.json");
    }

    // Create Cedarling instance
    await this.rebuildCedarling();

    this.logger.info(
      `Cedarling engine initialized: ${this.policies.size} policies, ` +
        `WASM ${this.cedarling ? "active" : "unavailable"}`
    );
  }

  /**
   * Authorize a request using Cedarling WASM.
   */
  async authorize(request: AuthzRequest): Promise<CedarDecision> {
    if (!this.cedarling) {
      // Fallback: basic string matching (same as homebrew engine)
      return this.authorizeBasic(request);
    }

    try {
      // Build the principal ID from the request
      const principalId = request.principal
        .replace(/.*::"/g, "")
        .replace(/"$/, "");

      const resourceId = request.resource
        .replace(/.*::"/g, "")
        .replace(/"$/, "");

      const actionName = request.action
        .replace(/.*::"/g, "")
        .replace(/"$/, "");

      // Determine resource entity type from the request string
      // Supports Tool::"x", Shell::"x", API::"x", etc.
      let resourceEntityType = "Tool";
      const typeMatch = request.resource.match(/^(?:\w+::)?(\w+)::/);
      if (typeMatch) resourceEntityType = typeMatch[1];

      const result = await this.cedarling.authorize_unsigned({
        principals: [
          {
            cedar_entity_mapping: {
              entity_type: `${this.namespace}::${this.agentEntityType}`,
              id: principalId,
            },
            name: principalId,
          },
        ],
        action: `${this.namespace}::Action::"${actionName}"`,
        resource: {
          cedar_entity_mapping: {
            entity_type: `${this.namespace}::${resourceEntityType}`,
            id: resourceId,
          },
          ...(request.context ?? {}),
        },
        context: request.context ?? {},
      });

      const decision = result.decision ? "allow" : "deny";
      const resultJson = JSON.parse(result.json_string());

      // Extract reasons from all principals
      const reasons: string[] = [];
      if (resultJson.principals) {
        for (const [princName, princResult] of Object.entries(resultJson.principals) as any) {
          const diag = princResult.diagnostics;
          if (diag?.reason) {
            for (const r of diag.reason) {
              reasons.push(`${princResult.decision ? "permit" : "deny"}: ${r}`);
            }
          }
        }
      }

      return { decision: decision as "allow" | "deny", reasons };
    } catch (err: any) {
      this.logger.error(`Cedarling authorize error: ${err.message}`);
      return { decision: "deny", reasons: [`cedarling error: ${err.message}`] };
    }
  }

  /**
   * Enable a resource by adding a permit policy and rebuilding Cedarling.
   * resourceType: "Tool" | "Shell" | "API"
   * action: the Cedar action name (e.g., "call_tool", "exec_command", "call_api")
   */
  enableResource(qualifiedName: string, resourceType: string = "Tool", action: string = "call_tool"): void {
    const slug = qualifiedName.replace(/[^a-zA-Z0-9_-]/g, "-");
    const policyId = `${resourceType.toLowerCase()}-enable-${slug}`;
    const raw = `permit(\n  principal is ${this.namespace}::${this.agentEntityType},\n  action == ${this.namespace}::Action::"${action}",\n  resource == ${this.namespace}::${resourceType}::"${qualifiedName}"\n);`;

    const disableId = `${resourceType.toLowerCase()}-disable-${slug}`;
    this.removePolicyFile(disableId);

    this.writePolicyFile(policyId, raw);
    this.policies.set(policyId, { effect: "permit", raw });
    this.rebuildCedarling().catch(() => {});
    this.logger.info(`Enabled ${resourceType}: ${qualifiedName}`);
  }

  /**
   * Disable a resource by adding a forbid policy and rebuilding Cedarling.
   */
  disableResource(qualifiedName: string, resourceType: string = "Tool", action: string = "call_tool"): void {
    const slug = qualifiedName.replace(/[^a-zA-Z0-9_-]/g, "-");
    const policyId = `${resourceType.toLowerCase()}-disable-${slug}`;
    const raw = `forbid(\n  principal,\n  action == ${this.namespace}::Action::"${action}",\n  resource == ${this.namespace}::${resourceType}::"${qualifiedName}"\n);`;

    const enableId = `${resourceType.toLowerCase()}-enable-${slug}`;
    this.removePolicyFile(enableId);

    this.writePolicyFile(policyId, raw);
    this.policies.set(policyId, { effect: "forbid", raw });
    this.rebuildCedarling().catch(() => {});
    this.logger.info(`Disabled ${resourceType}: ${qualifiedName}`);
  }

  /** Backwards-compatible aliases */
  enableTool(qualifiedName: string): void {
    this.enableResource(qualifiedName, "Tool", "call_tool");
  }
  disableTool(qualifiedName: string): void {
    this.disableResource(qualifiedName, "Tool", "call_tool");
  }

  /**
   * Check if a tool is enabled (synchronous check against local policy state).
   * Checks both specific tool policies AND blanket policies (those without a specific tool name).
   */
  isToolEnabled(qualifiedName: string): boolean {
    let hasPermit = false;
    let hasForbid = false;
    for (const [, policy] of this.policies) {
      // Check if policy specifically references this tool
      const refersToTool = policy.raw.includes(`"${qualifiedName}"`);
      // Check if policy is a blanket policy (no specific Tool:: reference)
      const isBlanket = !policy.raw.includes('Tool::"');

      if (refersToTool || isBlanket) {
        if (policy.effect === "permit") hasPermit = true;
        if (policy.effect === "forbid") hasForbid = true;
      }
    }
    return hasPermit && !hasForbid;
  }

  savePolicy(id: string, raw: string): void {
    const effect = raw.trimStart().startsWith("forbid") ? "forbid" : "permit";
    this.writePolicyFile(id, raw);
    this.policies.set(id, { effect, raw });
    this.rebuildCedarling().catch(() => {});
    this.logger.info(`Saved policy: ${id}`);
  }

  deletePolicy(id: string): boolean {
    if (!this.policies.has(id)) return false;
    this.removePolicyFile(id);
    this.policies.delete(id);
    this.rebuildCedarling().catch(() => {});
    this.logger.info(`Deleted policy: ${id}`);
    return true;
  }

  getPolicies(): Array<{ id: string; effect: string; raw: string }> {
    return [...this.policies.entries()].map(([id, p]) => ({ id, ...p }));
  }

  getSchema(): CedarSchemaInfo {
    return {
      ...this.parseSchemaForGui(this.schemaRaw),
      raw: this.schemaRaw,
    };
  }

  saveSchema(raw: string): void {
    const schemaPath = join(this.policyDir, "schema.json");
    writeFileSync(schemaPath, raw, "utf-8");
    this.schemaRaw = raw;
    try {
      this.schemaJson = JSON.parse(raw);
    } catch {}
    this.rebuildCedarling().catch(() => {});
    this.logger.info("Schema updated");
  }

  async verify(): Promise<VerifyResult> {
    const start = Date.now();

    if (!this.cedarling) {
      return {
        ok: true,
        issues: ["Cedarling WASM not loaded — cannot verify"],
        durationMs: Date.now() - start,
      };
    }

    // Verification: try dummy authorize requests for each resource type.
    // If the policy store loaded, schemas and policies are valid.
    try {
      for (const [action, resType] of [["call_tool", "Tool"], ["exec_command", "Shell"], ["call_api", "API"]]) {
        await this.cedarling.authorize_unsigned({
          principals: [
            {
              cedar_entity_mapping: {
                entity_type: `${this.namespace}::${this.agentEntityType}`,
                id: "__verify_probe__",
              },
            },
          ],
          action: `${this.namespace}::Action::"${action}"`,
          resource: {
            cedar_entity_mapping: {
              entity_type: `${this.namespace}::${resType}`,
              id: "__verify_probe__",
            },
          },
          context: {},
        });
      }
      return { ok: true, issues: [], durationMs: Date.now() - start };
    } catch (err: any) {
      return {
        ok: false,
        issues: [err.message],
        durationMs: Date.now() - start,
      };
    }
  }

  // ── Private: WASM loading ──

  private async loadWasm(): Promise<void> {
    const mod = await import("@janssenproject/cedarling_wasm");
    this.wasmModule = mod;

    // Find the WASM binary
    const modPath = fileURLToPath(import.meta.resolve("@janssenproject/cedarling_wasm"));
    const wasmPath = join(dirname(modPath), "cedarling_wasm_bg.wasm");
    const wasmBytes = readFileSync(wasmPath);

    mod.initSync({ module: wasmBytes });
    this.logger.info("Cedarling WASM loaded successfully");
  }

  /**
   * Rebuild the Cedarling instance from current policies and schema.
   * Called after any policy or schema change.
   */
  private async rebuildCedarling(): Promise<void> {
    if (!this.wasmModule) return;

    try {
      const policyStore = this.buildPolicyStore();
      const config = {
        CEDARLING_APPLICATION_NAME: "Carapace",
        CEDARLING_POLICY_STORE_LOCAL: JSON.stringify(policyStore),
        CEDARLING_LOG_TYPE: "off",
        CEDARLING_USER_AUTHZ: "disabled",
        CEDARLING_WORKLOAD_AUTHZ: "enabled",
        CEDARLING_JWT_SIG_VALIDATION: "disabled",
        CEDARLING_JWT_SIGNATURE_ALGORITHMS_SUPPORTED: ["ES256"],
        CEDARLING_ID_TOKEN_TRUST_MODE: "strict",
        CEDARLING_MAPPING_WORKLOAD: `${this.namespace}::${this.agentEntityType}`,
        // Check if the workload principal got ALLOW
        CEDARLING_PRINCIPAL_BOOLEAN_OPERATION: {
          or: [
            { "===": [{ var: `${this.namespace}::${this.agentEntityType}` }, "ALLOW"] },
          ],
        },
      };

      this.cedarling = await this.wasmModule.init(config);
      this.logger.debug?.("Cedarling instance rebuilt");
    } catch (err: any) {
      this.logger.error(`Failed to rebuild Cedarling: ${err.message}`);
      // Don't null out cedarling — keep the old instance if it exists
    }
  }

  /**
   * Build a Cedarling Policy Store JSON from current policies and schema.
   */
  private buildPolicyStore(): PolicyStoreJson {
    const policies: Record<string, PolicyStoreEntry> = {};
    for (const [id, policy] of this.policies) {
      policies[id] = {
        description: id,
        creation_date: new Date().toISOString(),
        policy_content: Buffer.from(policy.raw).toString("base64"),
      };
    }

    // If no policies and default is allow-all, add a default permit
    if (Object.keys(policies).length === 0 && this.defaultPolicy === "allow-all") {
      const raw = `permit(\n  principal is ${this.namespace}::${this.agentEntityType},\n  action,\n  resource\n);`;
      policies["default-allow"] = {
        description: "Default allow-all policy",
        creation_date: new Date().toISOString(),
        policy_content: Buffer.from(raw).toString("base64"),
      };
    }

    // If no policies at all, add a dummy deny to keep Cedarling happy
    // (empty policy sets can cause issues)
    if (Object.keys(policies).length === 0) {
      const raw = `forbid(\n  principal,\n  action,\n  resource\n) when { false };`;
      policies["__default_deny__"] = {
        description: "Default deny placeholder",
        creation_date: new Date().toISOString(),
        policy_content: Buffer.from(raw).toString("base64"),
      };
    }

    const schemaB64 = Buffer.from(
      this.schemaRaw || JSON.stringify(this.buildDefaultSchemaJson())
    ).toString("base64");

    return {
      cedar_version: "v4.0.0",
      policy_stores: {
        mcp: {
          name: "Carapace",
          description: "Auto-generated policy store for MCP tool authorization",
          policies,
          schema: schemaB64,
          trusted_issuers: {},
        },
      },
    };
  }

  // ── Private: disk I/O ──

  private loadPoliciesFromDisk(): void {
    this.policies.clear();
    if (!existsSync(this.policyDir)) return;
    for (const file of readdirSync(this.policyDir)) {
      if (!file.endsWith(".cedar")) continue;
      const path = join(this.policyDir, file);
      const raw = readFileSync(path, "utf-8");
      const id = file.replace(".cedar", "");
      const effect = raw.trimStart().startsWith("forbid") ? "forbid" : "permit";
      this.policies.set(id, { effect, raw });
    }
  }

  private writePolicyFile(id: string, raw: string): void {
    writeFileSync(join(this.policyDir, `${id}.cedar`), raw, "utf-8");
  }

  private removePolicyFile(id: string): void {
    const path = join(this.policyDir, `${id}.cedar`);
    if (existsSync(path)) unlinkSync(path);
    this.policies.delete(id);
  }

  private writeDefaultSchema(): void {
    const schema = this.buildDefaultSchemaJson();
    const schemaPath = join(this.policyDir, "schema.json");
    writeFileSync(schemaPath, JSON.stringify(schema, null, 2), "utf-8");
    this.logger.info("Created default Cedar JSON schema");
  }

  private buildDefaultSchemaJson(): Record<string, any> {
    return {
      [this.namespace]: {
        entityTypes: {
          [this.agentEntityType]: {
            shape: {
              type: "Record",
              attributes: {
                name: {
                  type: "EntityOrCommon",
                  name: "String",
                  required: false,
                },
              },
            },
          },
          Tool: {
            shape: {
              type: "Record",
              attributes: {
                server: {
                  type: "EntityOrCommon",
                  name: "String",
                  required: false,
                },
                name: {
                  type: "EntityOrCommon",
                  name: "String",
                  required: false,
                },
              },
            },
          },
          Shell: {
            shape: {
              type: "Record",
              attributes: {
                command: {
                  type: "EntityOrCommon",
                  name: "String",
                  required: false,
                },
                workdir: {
                  type: "EntityOrCommon",
                  name: "String",
                  required: false,
                },
              },
            },
          },
          API: {
            shape: {
              type: "Record",
              attributes: {
                url: {
                  type: "EntityOrCommon",
                  name: "String",
                  required: false,
                },
                method: {
                  type: "EntityOrCommon",
                  name: "String",
                  required: false,
                },
                domain: {
                  type: "EntityOrCommon",
                  name: "String",
                  required: false,
                },
              },
            },
          },
        },
        actions: {
          call_tool: {
            appliesTo: {
              principalTypes: [this.agentEntityType],
              resourceTypes: ["Tool"],
              context: { type: "Record", attributes: {} },
            },
          },
          list_tools: {
            appliesTo: {
              principalTypes: [this.agentEntityType],
              resourceTypes: ["Tool"],
              context: { type: "Record", attributes: {} },
            },
          },
          exec_command: {
            appliesTo: {
              principalTypes: [this.agentEntityType],
              resourceTypes: ["Shell"],
              context: {
                type: "Record",
                attributes: {
                  args: {
                    type: "EntityOrCommon",
                    name: "String",
                    required: false,
                  },
                  workdir: {
                    type: "EntityOrCommon",
                    name: "String",
                    required: false,
                  },
                },
              },
            },
          },
          call_api: {
            appliesTo: {
              principalTypes: [this.agentEntityType],
              resourceTypes: ["API"],
              context: {
                type: "Record",
                attributes: {
                  url: {
                    type: "EntityOrCommon",
                    name: "String",
                    required: false,
                  },
                  method: {
                    type: "EntityOrCommon",
                    name: "String",
                    required: false,
                  },
                  body: {
                    type: "EntityOrCommon",
                    name: "String",
                    required: false,
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  // ── Private: basic fallback ──

  private authorizeBasic(request: AuthzRequest): CedarDecision {
    let hasPermit = false;
    let hasForbid = false;
    const reasons: string[] = [];

    for (const [id, policy] of this.policies) {
      // Simple: check if resource appears in the policy
      const resourceId = request.resource.replace(/.*::"/g, "").replace(/"$/, "");
      if (!policy.raw.includes(`"${resourceId}"`)) continue;

      if (policy.effect === "forbid") {
        hasForbid = true;
        reasons.push(`forbid: ${id}`);
      } else {
        hasPermit = true;
        reasons.push(`permit: ${id}`);
      }
    }

    if (hasForbid) return { decision: "deny", reasons };
    if (hasPermit) return { decision: "allow", reasons };
    return { decision: "deny", reasons: ["no matching permit policy"] };
  }

  // ── Private: schema parsing for GUI ──

  private parseSchemaForGui(raw: string): { entities: SchemaEntity[]; actions: SchemaAction[] } {
    const entities: SchemaEntity[] = [];
    const actions: SchemaAction[] = [];

    try {
      const schema = typeof raw === "string" ? JSON.parse(raw) : raw;
      const ns = schema[this.namespace];
      if (!ns) return { entities, actions };

      // Entity types
      if (ns.entityTypes) {
        for (const [name, def] of Object.entries(ns.entityTypes) as any) {
          const attrs: SchemaAttribute[] = [];
          if (def.shape?.attributes) {
            for (const [aName, aDef] of Object.entries(def.shape.attributes) as any) {
              attrs.push({
                name: aName,
                type: aDef.name || aDef.type || "unknown",
                optional: aDef.required === false,
              });
            }
          }
          entities.push({ name, parents: [], attributes: attrs });
        }
      }

      // Actions
      if (ns.actions) {
        for (const [name, def] of Object.entries(ns.actions) as any) {
          actions.push({
            name,
            principalTypes: def.appliesTo?.principalTypes ?? [],
            resourceTypes: def.appliesTo?.resourceTypes ?? [],
          });
        }
      }
    } catch (err) {
      this.logger.debug?.(`Schema parse error: ${err}`);
    }

    return { entities, actions };
  }
}
