/**
 * Carapace — OpenClaw Plugin
 *
 * Aggregates upstream MCP servers, enforces Cedar policies on tool access,
 * and serves a local GUI for human oversight.
 */

import { CedarlingEngine } from "./cedar-engine-cedarling.js";
import { McpAggregator } from "./mcp-aggregator.js";
import { ControlGui } from "./gui/server.js";
import type { PluginApi, PluginConfig } from "./types.js";

export const id = "carapace";
export const name = "Carapace";

export default function register(api: PluginApi) {
  const config: PluginConfig = api.config?.plugins?.entries?.["carapace"]?.config ?? {};
  const logger = api.logger;

  const cedar = new CedarlingEngine({
    policyDir: config.policyDir ?? "~/.openclaw/mcp-policies/",
    defaultPolicy: config.defaultPolicy ?? "deny-all",
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
  api.registerTool?.({
    name: "mcp_tools",
    description:
      "List all MCP tools available through the Cedar proxy, with their enabled/disabled status",
    parameters: {
      type: "object",
      properties: {
        server: {
          type: "string",
          description: "Filter by server name (optional)",
        },
      },
    },
    async handler({ server }: { server?: string }) {
      const tools = aggregator.listTools(server);
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
  api.registerTool?.({
    name: "mcp_call",
    description:
      "Call an MCP tool through the Cedar proxy. The call is authorized by Cedar policies before reaching the upstream server.",
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
    async handler({ tool, arguments: args }: { tool: string; arguments?: Record<string, unknown> }) {
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

  // --- CLI command ---
  api.registerCli?.(
    ({ program }) => {
      const cmd = program.command("mcp-proxy").description("Carapace management");

      cmd.command("status").action(async () => {
        const servers = aggregator.getServerStatus();
        console.log("\nCarapace Status\n");
        for (const [name, status] of Object.entries(servers)) {
          const icon = status.connected ? "✅" : "❌";
          console.log(`  ${icon} ${name} — ${status.toolCount} tools`);
        }
        console.log(`\nGUI: http://localhost:${config.guiPort ?? 19820}\n`);
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
    { commands: ["mcp-proxy"] },
  );

  // --- Gateway RPC ---
  api.registerGatewayMethod?.("carapace.status", ({ respond }) => {
    const servers = aggregator.getServerStatus();
    const tools = aggregator.listTools();
    respond(true, { servers, toolCount: tools.length, enabledCount: tools.filter((t) => t.enabled).length });
  });
}
