/**
 * MCP Aggregator — connects to multiple upstream MCP servers,
 * discovers their tools, and proxies calls through Cedar authorization.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
// import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Logger, ServerConfig, McpTool, ServerStatus, CedarEngineInterface } from "./types.js";

interface AggregatorOpts {
  servers: Record<string, ServerConfig>;
  cedar: CedarEngineInterface;
  logger: Logger;
}

interface ConnectedServer {
  name: string;
  config: ServerConfig;
  client: Client;
  transport: any;
  tools: McpTool[];
  connected: boolean;
  error?: string;
}

export class McpAggregator {
  private servers: Map<string, ConnectedServer> = new Map();
  private serverConfigs: Record<string, ServerConfig>;
  private cedar: CedarEngineInterface;
  private logger: Logger;

  constructor(opts: AggregatorOpts) {
    this.serverConfigs = opts.servers;
    this.cedar = opts.cedar;
    this.logger = opts.logger;
  }

  /** Connect to all configured MCP servers and discover tools */
  async connectAll(): Promise<void> {
    const entries = Object.entries(this.serverConfigs);
    this.logger.info(`Connecting to ${entries.length} MCP server(s)...`);

    await Promise.allSettled(
      entries.map(([name, config]) => this.connectServer(name, config)),
    );

    const total = this.listTools().length;
    const connected = [...this.servers.values()].filter((s) => s.connected).length;
    this.logger.info(`Connected: ${connected}/${entries.length} servers, ${total} tools discovered`);
  }

  /** Disconnect all servers */
  async disconnectAll(): Promise<void> {
    for (const [name, server] of this.servers) {
      try {
        await server.transport?.close?.();
        this.logger.debug?.(`Disconnected: ${name}`);
      } catch (err) {
        this.logger.warn(`Error disconnecting ${name}: ${err}`);
      }
    }
    this.servers.clear();
  }

  /** List all discovered tools across all servers */
  listTools(serverFilter?: string): McpTool[] {
    const tools: McpTool[] = [];
    for (const server of this.servers.values()) {
      if (serverFilter && server.name !== serverFilter) continue;
      for (const tool of server.tools) {
        tools.push({
          ...tool,
          enabled: this.cedar.isToolEnabled(tool.qualifiedName),
        });
      }
    }
    return tools;
  }

  /** Get status of all servers */
  getServerStatus(): Record<string, ServerStatus> {
    const status: Record<string, ServerStatus> = {};
    for (const [name, server] of this.servers) {
      status[name] = {
        connected: server.connected,
        toolCount: server.tools.length,
        error: server.error,
      };
    }
    return status;
  }

  /** Call a tool on the appropriate upstream server */
  async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<any> {
    const [serverName, toolName] = qualifiedName.split("/", 2);
    const server = this.servers.get(serverName);

    if (!server) {
      return {
        content: [{ type: "text", text: `Server not found: ${serverName}` }],
        isError: true,
      };
    }

    if (!server.connected) {
      return {
        content: [{ type: "text", text: `Server not connected: ${serverName}` }],
        isError: true,
      };
    }

    try {
      const result = await server.client.callTool({ name: toolName, arguments: args });
      return result;
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Tool call failed: ${err.message}` }],
        isError: true,
      };
    }
  }

  // --- Private ---

  private async connectServer(name: string, config: ServerConfig): Promise<void> {
    const entry: ConnectedServer = {
      name,
      config,
      client: new Client({ name: `mcp-cedar-proxy/${name}`, version: "0.1.0" }),
      transport: null,
      tools: [],
      connected: false,
    };

    try {
      if (config.transport === "stdio") {
        if (!config.command) throw new Error("stdio transport requires 'command'");

        entry.transport = new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
        });
      } else if (config.transport === "http" || config.transport === "sse") {
        if (!config.url) throw new Error(`${config.transport} transport requires 'url'`);

        // TODO: Add HTTP/SSE transport support
        // For now, only stdio is implemented
        throw new Error(`${config.transport} transport not yet implemented — use stdio`);
      } else {
        throw new Error(`Unknown transport: ${config.transport}`);
      }

      await entry.client.connect(entry.transport);
      entry.connected = true;

      // Discover tools
      const toolsResult = await entry.client.listTools();
      entry.tools = (toolsResult.tools ?? []).map((t) => ({
        name: t.name,
        qualifiedName: `${name}/${t.name}`,
        server: name,
        description: t.description ?? "",
        inputSchema: t.inputSchema,
        enabled: false, // Will be resolved against Cedar policies
      }));

      this.logger.info(`Connected to ${name}: ${entry.tools.length} tools`);
    } catch (err: any) {
      entry.error = err.message;
      this.logger.warn(`Failed to connect to ${name}: ${err.message}`);
    }

    this.servers.set(name, entry);
  }
}
