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

/** A gated resource — tools, shell commands, or APIs */
export interface GatedResource {
  id: string;              // unique identifier (e.g., "filesystem/read_file", "bash", "api.github.com")
  type: "tool" | "shell" | "api";
  name: string;            // display name
  description: string;
  source: string;          // server name, "local", or domain
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface ShellRule {
  id: string;              // e.g., "bash", "git", "npm"
  pattern: string;         // command pattern (binary name or glob)
  description: string;
  enabled: boolean;
}

export interface ApiRule {
  id: string;              // e.g., "api.github.com", "registry.npmjs.org"
  pattern: string;         // URL pattern (domain or prefix)
  method?: string;         // HTTP method filter (optional)
  description: string;
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
