/**
 * Type definitions for the MCP Cedar Proxy plugin.
 */

export interface PluginApi {
  config: any;
  logger: Logger;
  registerService(service: { id: string; start(): Promise<void> | void; stop(): Promise<void> | void }): void;
  registerTool?(tool: ToolDef): void;
  registerCli?(fn: (ctx: { program: any }) => void, opts?: { commands: string[] }): void;
  registerGatewayMethod?(name: string, handler: (ctx: { respond: (ok: boolean, data: any) => void }) => void): void;
}

export interface Logger {
  info(msg: string, ...args: any[]): void;
  warn(msg: string, ...args: any[]): void;
  error(msg: string, ...args: any[]): void;
  debug(msg: string, ...args: any[]): void;
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

export interface VerifyResult {
  ok: boolean;
  issues: string[];
  durationMs: number;
}
