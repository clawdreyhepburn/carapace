/**
 * Carapace — OpenClaw Plugin
 *
 * Aggregates upstream MCP servers, enforces Cedar policies on tool access,
 * and serves a local GUI for human oversight.
 */

import { CedarlingEngine } from "./cedar-engine-cedarling.js";
import { McpAggregator } from "./mcp-aggregator.js";
import { ControlGui } from "./gui/server.js";
import type { PluginConfig } from "./types.js";

export const id = "carapace";
export const name = "Carapace";

/**
 * OpenClaw plugin API shape (matches real runtime).
 * We define it here to avoid depending on OpenClaw types at build time.
 */
interface OpenClawPluginApi {
  pluginConfig: any;
  logger: {
    info(msg: string, ...args: any[]): void;
    warn(msg: string, ...args: any[]): void;
    error(msg: string, ...args: any[]): void;
    debug?(msg: string, ...args: any[]): void;
  };
  registerService(service: { id: string; start(): Promise<void> | void; stop(): Promise<void> | void }): void;
  registerTool(
    tool: {
      name: string;
      label?: string;
      description: string;
      parameters: Record<string, any>;
      execute(toolCallId: string, params: any): Promise<any>;
    },
    opts?: { optional?: boolean },
  ): void;
  registerCli?(fn: (ctx: { program: any }) => void, opts?: { commands: string[] }): void;
  registerGatewayMethod?(name: string, handler: (ctx: { respond: (ok: boolean, data: any) => void }) => void): void;
}

export default function register(api: OpenClawPluginApi) {
  const config: PluginConfig = api.pluginConfig ?? {};
  const logger = api.logger;

  const cedar = new CedarlingEngine({
    policyDir: config.policyDir ?? "~/.openclaw/mcp-policies/",
    defaultPolicy: config.defaultPolicy ?? "allow-all",
    verify: config.verify ?? false,
    logger,
  });

  const aggregator = new McpAggregator({
    servers: config.servers ?? {},
    cedar,
    logger,
  });

  const gui = new ControlGui({
    port: config.guiPort ?? 19820,
    aggregator,
    cedar,
    logger,
  });

  // --- Background service: connect to MCP servers and serve GUI ---
  api.registerService({
    id: "carapace",
    async start() {
      logger.info("Carapace starting...");
      await cedar.init();
      await aggregator.connectAll();
      await gui.start();
      logger.info(`Control GUI at http://localhost:${config.guiPort ?? 19820}`);
    },
    async stop() {
      await gui.stop();
      await aggregator.disconnectAll();
      logger.info("Carapace stopped");
    },
  });

  // --- Agent tool: list available MCP tools ---
  api.registerTool({
    name: "mcp_tools",
    label: "MCP Tools (Carapace)",
    description:
      "List all MCP tools available through the Carapace Cedar proxy, with their enabled/disabled status",
    parameters: {
      type: "object",
      properties: {
        server: {
          type: "string",
          description: "Filter by server name (optional)",
        },
      },
    },
    async execute(_toolCallId: string, params: { server?: string }) {
      const tools = aggregator.listTools(params.server);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(tools, null, 2),
          },
        ],
      };
    },
  });

  // --- Agent tool: invoke an MCP tool through the proxy ---
  api.registerTool({
    name: "mcp_call",
    label: "MCP Call (Carapace)",
    description:
      "Call an MCP tool through the Carapace Cedar proxy. The call is authorized by Cedar policies before reaching the upstream server.",
    parameters: {
      type: "object",
      required: ["tool"],
      properties: {
        tool: {
          type: "string",
          description: 'Fully qualified tool name (e.g., "github/create_issue")',
        },
        arguments: {
          type: "object",
          description: "Arguments to pass to the tool",
        },
      },
    },
    async execute(_toolCallId: string, params: { tool: string; arguments?: Record<string, unknown> }) {
      const { tool, arguments: args } = params;

      // Authorize via Cedar
      const decision = await cedar.authorize({
        principal: 'Agent::"openclaw"',
        action: 'Action::"call_tool"',
        resource: `Tool::"${tool}"`,
        context: args ? { arguments: args } : {},
      });

      if (decision.decision === "deny") {
        return {
          content: [
            {
              type: "text",
              text: `DENIED by Cedar policy: ${tool}\nReason: ${decision.reasons.join(", ") || "default deny"}`,
            },
          ],
          isError: true,
        };
      }

      // Forward to upstream MCP server
      const result = await aggregator.callTool(tool, args ?? {});
      return result;
    },
  });

  // --- Agent tool: execute a shell command through Cedar authorization ---
  api.registerTool({
    name: "carapace_exec",
    label: "Shell Exec (Carapace)",
    description:
      "Execute a shell command through the Carapace Cedar proxy. The command is authorized by Cedar policies before execution. Use this when you want Cedar-gated shell access.",
    parameters: {
      type: "object",
      required: ["command"],
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute (e.g., 'git status', 'npm install')",
        },
        workdir: {
          type: "string",
          description: "Working directory for the command (optional)",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default: 30)",
        },
      },
    },
    async execute(_toolCallId: string, params: { command: string; workdir?: string; timeout?: number }) {
      const { command, workdir, timeout = 30 } = params;

      // Extract the binary name for policy matching
      const binary = command.trim().split(/\s+/)[0].replace(/^.*\//, "");

      // Authorize via Cedar
      const decision = await cedar.authorize({
        principal: `Agent::"openclaw"`,
        action: `Action::"exec_command"`,
        resource: `Shell::"${binary}"`,
        context: { args: command, workdir: workdir ?? "" },
      });

      if (decision.decision === "deny") {
        return {
          content: [
            {
              type: "text",
              text: `DENIED by Cedar policy: shell command "${binary}"\nFull command: ${command}\nReason: ${decision.reasons.join(", ") || "default deny"}`,
            },
          ],
          isError: true,
        };
      }

      // Execute the command
      try {
        const { execSync } = await import("node:child_process");
        const result = execSync(command, {
          cwd: workdir,
          timeout: timeout * 1000,
          maxBuffer: 1024 * 1024,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err: any) {
        const output = err.stdout ?? err.stderr ?? err.message;
        return {
          content: [{ type: "text", text: `Command failed (exit ${err.status ?? "?"}): ${output}` }],
          isError: true,
        };
      }
    },
  }, { optional: true });

  // --- Agent tool: make an HTTP API call through Cedar authorization ---
  api.registerTool({
    name: "carapace_fetch",
    label: "API Fetch (Carapace)",
    description:
      "Make an HTTP API call through the Carapace Cedar proxy. The request is authorized by Cedar policies before being sent. Use this when you want Cedar-gated outbound API access.",
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch",
        },
        method: {
          type: "string",
          description: "HTTP method (GET, POST, PUT, DELETE, PATCH). Default: GET",
        },
        headers: {
          type: "object",
          description: "HTTP headers to include",
        },
        body: {
          type: "string",
          description: "Request body (for POST/PUT/PATCH)",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default: 30)",
        },
      },
    },
    async execute(_toolCallId: string, params: {
      url: string; method?: string; headers?: Record<string, string>; body?: string; timeout?: number
    }) {
      const { url, method = "GET", headers = {}, body, timeout = 30 } = params;

      // Extract domain for policy matching
      let domain: string;
      try {
        domain = new URL(url).hostname;
      } catch {
        return {
          content: [{ type: "text", text: `Invalid URL: ${url}` }],
          isError: true,
        };
      }

      // Authorize via Cedar
      const decision = await cedar.authorize({
        principal: `Agent::"openclaw"`,
        action: `Action::"call_api"`,
        resource: `API::"${domain}"`,
        context: { url, method, body: body ?? "" },
      });

      if (decision.decision === "deny") {
        return {
          content: [
            {
              type: "text",
              text: `DENIED by Cedar policy: API call to "${domain}"\nURL: ${url}\nMethod: ${method}\nReason: ${decision.reasons.join(", ") || "default deny"}`,
            },
          ],
          isError: true,
        };
      }

      // Make the HTTP request
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout * 1000);

        const response = await fetch(url, {
          method,
          headers,
          body: body ?? undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        const responseText = await response.text();
        const truncated = responseText.length > 50000
          ? responseText.slice(0, 50000) + "\n...[truncated]"
          : responseText;

        return {
          content: [
            {
              type: "text",
              text: `HTTP ${response.status} ${response.statusText}\n\n${truncated}`,
            },
          ],
          isError: !response.ok,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `API call failed: ${err.message}` }],
          isError: true,
        };
      }
    },
  }, { optional: true });

  // --- CLI command ---
  api.registerCli?.(
    ({ program }) => {
      const cmd = program.command("carapace").description("Carapace — MCP tool authorization");

      cmd.command("status").action(async () => {
        const servers = aggregator.getServerStatus();
        console.log("\n🦞 Carapace Status\n");
        for (const [name, status] of Object.entries(servers)) {
          const icon = status.connected ? "✅" : "❌";
          console.log(`  ${icon} ${name} — ${status.toolCount} tools`);
        }
        const tools = aggregator.listTools();
        const enabled = tools.filter((t) => t.enabled).length;
        console.log(`\n  ${enabled}/${tools.length} tools enabled`);
        console.log(`  GUI: http://localhost:${config.guiPort ?? 19820}\n`);
      });

      cmd.command("tools").action(async () => {
        const tools = aggregator.listTools();
        for (const tool of tools) {
          const icon = tool.enabled ? "🟢" : "🔴";
          console.log(`  ${icon} ${tool.qualifiedName} — ${tool.description}`);
        }
      });

      cmd.command("verify").action(async () => {
        const result = await cedar.verify();
        if (result.ok) {
          console.log("✅ All policies verified");
        } else {
          console.log("⚠️  Verification issues:");
          for (const issue of result.issues) {
            console.log(`  - ${issue}`);
          }
        }
      });
    },
    { commands: ["carapace"] },
  );

  // --- Gateway RPC ---
  api.registerGatewayMethod?.("carapace.status", ({ respond }) => {
    const servers = aggregator.getServerStatus();
    const tools = aggregator.listTools();
    respond(true, { servers, toolCount: tools.length, enabledCount: tools.filter((t) => t.enabled).length });
  });
}
