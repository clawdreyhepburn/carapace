/**
 * Carapace — OpenClaw Plugin
 *
 * Enforces Cedar policies on tool access via OpenClaw's before_tool_call hook.
 * No proxy, no baseUrl redirect, no models.json patching.
 */

import { CedarlingEngine } from "./cedar-engine-cedarling.js";
import { McpAggregator } from "./mcp-aggregator.js";
import { ControlGui } from "./gui/server.js";
import type { PluginConfig } from "./types.js";

export const id = "carapace";
export const name = "Carapace";

/**
 * OpenClaw plugin API shape (matches real runtime).
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
  registerHook?(hookName: string | string[], handler: (event: any) => Promise<any> | any, opts?: { name: string; description?: string; priority?: number }): void;
  registerCli?(fn: (ctx: { program: any }) => void, opts?: { commands: string[] }): void;
  registerGatewayMethod?(name: string, handler: (ctx: { respond: (ok: boolean, data: any) => void }) => void): void;
}

/**
 * @deprecated Kept for backward compatibility. No longer used.
 */
function buildUpstreamConfig(proxyConfig: NonNullable<PluginConfig["proxy"]>): {
  anthropic?: { url: string; apiKey: string };
  openai?: { url: string; apiKey: string };
} {
  const upstream = proxyConfig.upstream;
  if (!upstream) return {};
  if (typeof upstream === "string") {
    const apiKey = proxyConfig.apiKey ?? "";
    if (upstream.includes("anthropic")) return { anthropic: { url: upstream, apiKey } };
    if (upstream.includes("openai")) return { openai: { url: upstream, apiKey } };
    return { anthropic: { url: upstream, apiKey } };
  }
  return {
    anthropic: upstream.anthropic ? { url: upstream.anthropic.url ?? "https://api.anthropic.com", apiKey: upstream.anthropic.apiKey } : undefined,
    openai: upstream.openai ? { url: upstream.openai.url ?? "https://api.openai.com", apiKey: upstream.openai.apiKey } : undefined,
  };
}

// Audit log
function appendAuditLog(entry: { timestamp: string; tool: string; decision: string; reasons: string[]; params?: any }): void {
  try {
    const { appendFileSync, mkdirSync } = require("node:fs");
    const { join } = require("node:path");
    const { homedir } = require("node:os");
    const logDir = join(homedir(), ".openclaw", "mcp-policies", "logs");
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, "audit.log"), JSON.stringify(entry) + "\n", "utf-8");
  } catch {}
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
    proxyEnabled: false, // proxy no longer used
  });

  // --- Hook stats ---
  const stats = {
    toolCallsEvaluated: 0,
    toolCallsDenied: 0,
  };

  // --- Register before_tool_call hook ---
  if (api.registerHook) {
    api.registerHook("before_tool_call", async (event: any) => {
      const toolName: string = event.toolName ?? event.tool ?? event.name ?? "";
      const params: Record<string, unknown> = event.params ?? event.arguments ?? event.input ?? {};

      if (!toolName) return {};

      stats.toolCallsEvaluated++;

      // Map tool call to Cedar authorization request
      let resourceType = "Tool";
      let action = "call_tool";
      let resourceId = toolName;
      let context: Record<string, unknown> = {};

      // Map known OpenClaw built-in tools to resource types
      if (toolName === "exec" || toolName === "process") {
        resourceType = "Shell";
        action = "exec_command";
        const cmd = (params.command as string) ?? "";
        resourceId = cmd.trim().split(/\s+/)[0]?.replace(/^.*\//, "") || toolName;
        context = { args: cmd, workdir: (params.workdir as string) ?? "" };
      } else if (toolName === "web_fetch" || toolName === "web_search") {
        resourceType = "API";
        action = "call_api";
        const url = (params.url as string) ?? (params.query as string) ?? "";
        try {
          resourceId = url.startsWith("http") ? new URL(url).hostname : toolName;
        } catch {
          resourceId = toolName;
        }
        context = { url, method: (params.method as string) ?? "GET", body: (params.body as string) ?? "" };
      } else if (toolName === "browser") {
        resourceType = "Tool";
        action = "call_tool";
        resourceId = "browser";
        context = { action: (params.action as string) ?? "" };
      } else {
        // MCP or other tools
        context = params ? { arguments: params } : {};
      }

      const decision = await cedar.authorize({
        principal: `Agent::"openclaw"`,
        action: `Action::"${action}"`,
        resource: `${resourceType}::"${resourceId}"`,
        context,
      });

      const auditEntry = {
        timestamp: new Date().toISOString(),
        tool: toolName,
        decision: decision.decision,
        reasons: decision.reasons,
        params: Object.keys(params).length > 0 ? params : undefined,
      };
      appendAuditLog(auditEntry);

      if (decision.decision === "deny") {
        stats.toolCallsDenied++;
        const reason = `Cedar policy denied: ${toolName} (${decision.reasons.join(", ") || "default deny"})`;
        logger.info(`🚫 ${reason}`);
        return { block: true, blockReason: reason };
      }

      return {};
    });
    logger.info("Registered before_tool_call hook for Cedar policy enforcement");
  } else {
    logger.warn("⚠️  before_tool_call hook not available — Cedar policies will NOT be enforced on built-in tools");
  }

  // --- Background service: connect to MCP servers and serve GUI ---
  api.registerService({
    id: "carapace",
    async start() {
      logger.info("Carapace starting...");
      await cedar.init();
      await aggregator.connectAll();
      await gui.start();
      logger.info(`Control GUI at http://localhost:${config.guiPort ?? 19820}`);

      // Warn if no policies are loaded
      const policies = cedar.getPolicies();
      if (policies.length === 0) {
        logger.warn(
          `⚠️  Carapace is loaded but NOT ENFORCING — no Cedar policies found. ` +
          `Add policies to ${config.policyDir ?? "~/.openclaw/mcp-policies/"} or use the GUI at http://localhost:${config.guiPort ?? 19820}`
        );
      }

      logger.info(
        `🛡️  Cedar enforcement active via before_tool_call hook — ` +
        `${policies.length} policies loaded, default: ${config.defaultPolicy ?? "allow-all"}`
      );
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
        content: [{ type: "text", text: JSON.stringify(tools, null, 2) }],
      };
    },
  });

  // --- Agent tool: invoke an MCP tool through Cedar ---
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
      const decision = await cedar.authorize({
        principal: 'Agent::"openclaw"',
        action: 'Action::"call_tool"',
        resource: `Tool::"${tool}"`,
        context: args ? { arguments: args } : {},
      });

      if (decision.decision === "deny") {
        return {
          content: [{ type: "text", text: `DENIED by Cedar policy: ${tool}\nReason: ${decision.reasons.join(", ") || "default deny"}` }],
          isError: true,
        };
      }

      const result = await aggregator.callTool(tool, args ?? {});
      return result;
    },
  });

  // --- Agent tool: Cedar-gated shell exec ---
  api.registerTool({
    name: "carapace_exec",
    label: "Shell Exec (Carapace)",
    description:
      "Execute a shell command through the Carapace Cedar proxy. The command is authorized by Cedar policies before execution.",
    parameters: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        workdir: { type: "string", description: "Working directory (optional)" },
        timeout: { type: "number", description: "Timeout in seconds (default: 30)" },
      },
    },
    async execute(_toolCallId: string, params: { command: string; workdir?: string; timeout?: number }) {
      const { command, workdir, timeout = 30 } = params;
      const binary = command.trim().split(/\s+/)[0].replace(/^.*\//, "");

      const decision = await cedar.authorize({
        principal: `Agent::"openclaw"`,
        action: `Action::"exec_command"`,
        resource: `Shell::"${binary}"`,
        context: { args: command, workdir: workdir ?? "" },
      });

      if (decision.decision === "deny") {
        return {
          content: [{ type: "text", text: `DENIED by Cedar policy: shell command "${binary}"\nFull command: ${command}\nReason: ${decision.reasons.join(", ") || "default deny"}` }],
          isError: true,
        };
      }

      try {
        const { execSync } = await import("node:child_process");
        const result = execSync(command, {
          cwd: workdir,
          timeout: timeout * 1000,
          maxBuffer: 1024 * 1024,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return { content: [{ type: "text", text: result }] };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Command failed (exit ${err.status ?? "?"}): ${err.stdout ?? err.stderr ?? err.message}` }],
          isError: true,
        };
      }
    },
  }, { optional: true });

  // --- Agent tool: Cedar-gated HTTP fetch ---
  api.registerTool({
    name: "carapace_fetch",
    label: "API Fetch (Carapace)",
    description:
      "Make an HTTP API call through Carapace Cedar authorization.",
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "The URL to fetch" },
        method: { type: "string", description: "HTTP method (default: GET)" },
        headers: { type: "object", description: "HTTP headers" },
        body: { type: "string", description: "Request body" },
        timeout: { type: "number", description: "Timeout in seconds (default: 30)" },
      },
    },
    async execute(_toolCallId: string, params: {
      url: string; method?: string; headers?: Record<string, string>; body?: string; timeout?: number
    }) {
      const { url, method = "GET", headers = {}, body, timeout = 30 } = params;

      let domain: string;
      try { domain = new URL(url).hostname; } catch {
        return { content: [{ type: "text", text: `Invalid URL: ${url}` }], isError: true };
      }

      const decision = await cedar.authorize({
        principal: `Agent::"openclaw"`,
        action: `Action::"call_api"`,
        resource: `API::"${domain}"`,
        context: { url, method, body: body ?? "" },
      });

      if (decision.decision === "deny") {
        return {
          content: [{ type: "text", text: `DENIED by Cedar policy: API call to "${domain}"\nURL: ${url}\nReason: ${decision.reasons.join(", ") || "default deny"}` }],
          isError: true,
        };
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout * 1000);
        const response = await fetch(url, { method, headers, body: body ?? undefined, signal: controller.signal });
        clearTimeout(timer);
        const responseText = await response.text();
        const truncated = responseText.length > 50000 ? responseText.slice(0, 50000) + "\n...[truncated]" : responseText;
        return { content: [{ type: "text", text: `HTTP ${response.status} ${response.statusText}\n\n${truncated}` }], isError: !response.ok };
      } catch (err: any) {
        return { content: [{ type: "text", text: `API call failed: ${err.message}` }], isError: true };
      }
    },
  }, { optional: true });

  // --- CLI commands ---
  api.registerCli?.(
    ({ program }) => {
      const cmd = program.command("carapace").description("Carapace — Cedar policy enforcement for agent tools");

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
        console.log(`  GUI: http://localhost:${config.guiPort ?? 19820}`);

        const policies = cedar.getPolicies();
        console.log(`\n  🛡️  Enforcement: before_tool_call hook`);
        console.log(`  Policies: ${policies.length} loaded`);
        console.log(`  Default: ${config.defaultPolicy ?? "allow-all"}`);
        console.log(`  Evaluated: ${stats.toolCallsEvaluated} | Denied: ${stats.toolCallsDenied}`);
        console.log();
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
          for (const issue of result.issues) console.log(`  - ${issue}`);
        }
      });

      cmd.command("setup")
        .description("Enable Carapace plugin in OpenClaw config")
        .action(async () => {
          const { readFileSync, writeFileSync, existsSync } = require("node:fs");
          const { join } = require("node:path");
          const { homedir } = require("node:os");

          console.log("\n🦞 Carapace Setup\n");

          const configPath = join(homedir(), ".openclaw", "openclaw.json");
          let cfg: any = {};
          if (existsSync(configPath)) {
            cfg = JSON.parse(readFileSync(configPath, "utf-8"));
          }

          if (!cfg.plugins) cfg.plugins = {};
          if (!cfg.plugins.entries) cfg.plugins.entries = {};
          if (!cfg.plugins.entries.carapace) cfg.plugins.entries.carapace = {};

          const alreadyEnabled = cfg.plugins.entries.carapace.enabled === true;

          cfg.plugins.entries.carapace.enabled = true;
          if (!cfg.plugins.entries.carapace.config) {
            cfg.plugins.entries.carapace.config = {
              defaultPolicy: "allow-all",
            };
          }

          writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");

          if (alreadyEnabled) {
            console.log("  ✅ Carapace already enabled. No changes needed.\n");
          } else {
            console.log("  ✅ Enabled carapace plugin in openclaw.json");
            console.log("  🛡️  Cedar policies enforced via before_tool_call hook");
            console.log("  📋 No models.json or baseUrl changes needed");
            console.log("\n  Restart the gateway for changes to take effect:");
            console.log("    openclaw gateway restart\n");
          }
        });

      cmd.command("uninstall")
        .description("Disable Carapace plugin")
        .action(async () => {
          const { readFileSync, writeFileSync, existsSync } = require("node:fs");
          const { join } = require("node:path");
          const { homedir } = require("node:os");

          console.log("\n🦞 Carapace Uninstall\n");

          const configPath = join(homedir(), ".openclaw", "openclaw.json");
          if (!existsSync(configPath)) {
            console.log("  No config file found. Nothing to undo.\n");
            return;
          }

          const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
          let changed = false;

          if (cfg.plugins?.entries?.carapace?.enabled) {
            cfg.plugins.entries.carapace.enabled = false;
            changed = true;
            console.log("  ✅ Disabled carapace plugin");
          }

          if (changed) {
            writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
            console.log("\n  Restart the gateway for changes to take effect:");
            console.log("    openclaw gateway restart\n");
            console.log("  To fully remove the plugin files:");
            console.log("    rm -rf ~/.openclaw/extensions/carapace\n");
          } else {
            console.log("  Carapace already disabled. Nothing to undo.\n");
          }
        });

      cmd.command("check")
        .description("Check Cedar policy status")
        .action(async () => {
          console.log("\n🦞 Carapace Security Check\n");
          const policies = cedar.getPolicies();
          if (policies.length === 0) {
            console.log("  ⚠️  No Cedar policies loaded.");
            console.log(`  Add policies to ${config.policyDir ?? "~/.openclaw/mcp-policies/"}\n`);
          } else {
            console.log(`  ✅ ${policies.length} Cedar policies loaded`);
            console.log(`  🛡️  Enforcement via before_tool_call hook`);
            console.log(`  Default: ${config.defaultPolicy ?? "allow-all"}\n`);
            for (const p of policies) {
              console.log(`    ${p.effect === "permit" ? "🟢" : "🔴"} ${p.id}`);
            }
            console.log();
          }
        });
    },
    { commands: ["carapace"] },
  );

  // --- Gateway RPC ---
  api.registerGatewayMethod?.("carapace.status", ({ respond }) => {
    const servers = aggregator.getServerStatus();
    const tools = aggregator.listTools();
    const policies = cedar.getPolicies();
    respond(true, {
      servers,
      toolCount: tools.length,
      enabledCount: tools.filter((t) => t.enabled).length,
      policyCount: policies.length,
      enforcement: "before_tool_call",
      stats,
    });
  });
}
