/**
 * Type definitions for the MCP Cedar Proxy plugin.
 */


export interface Logger {
  info(msg: string, ...args: any[]): void;
  warn(msg: string, ...args: any[]): void;
  error(msg: string, ...args: any[]): void;
  debug?(msg: string, ...args: any[]): void;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler(args: any): Promise<any>;
}

export interface PluginConfig {
  guiPort?: number;
  servers?: Record<string, ServerConfig>;
  policyDir?: string;
  defaultPolicy?: "deny-all" | "allow-all";
  verify?: boolean;
}

export interface ServerConfig {
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface McpTool {
  name: string;
  qualifiedName: string; // "server/tool"
  server: string;
  description: string;
  inputSchema?: Record<string, any>;
  enabled: boolean;
}

export interface ServerStatus {
  connected: boolean;
  toolCount: number;
  lastSeen?: number;
  error?: string;
}

export interface CedarDecision {
  decision: "allow" | "deny";
  reasons: string[];
}

export interface AuthzRequest {
  principal: string;
  action: string;
  resource: string;
  context?: Record<string, unknown>;
}

/** Common interface for Cedar engines (homebrew and Cedarling) */
export interface CedarEngineInterface {
  init(): Promise<void>;
  authorize(request: AuthzRequest): Promise<CedarDecision>;
  enableTool(qualifiedName: string): void;
  disableTool(qualifiedName: string): void;
  isToolEnabled(qualifiedName: string): boolean;
  savePolicy(id: string, raw: string): void;
  deletePolicy(id: string): boolean;
  getPolicies(): Array<{ id: string; effect: string; raw: string }>;
  getSchema(): CedarSchemaInfo;
  saveSchema(raw: string): void;
  verify(): Promise<VerifyResult>;
}

export interface VerifyResult {
  ok: boolean;
  issues: string[];
  durationMs: number;
}

export interface CedarSchemaInfo {
  entities: SchemaEntity[];
  actions: SchemaAction[];
  raw: string;
}

export interface SchemaEntity {
  name: string;
  parents: string[];
  attributes: SchemaAttribute[];
}

export interface SchemaAttribute {
  name: string;
  type: string;
  optional: boolean;
}

export interface SchemaAction {
  name: string;
  principalTypes: string[];
  resourceTypes: string[];
}
