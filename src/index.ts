/**
 * Carapace — OpenClaw Plugin
 *
 * Aggregates upstream MCP servers, enforces Cedar policies on tool access,
 * and serves a local GUI for human oversight.
 */

import { CedarlingEngine } from "./cedar-engine-cedarling.js";
import { McpAggregator } from "./mcp-aggregator.js";
import { ControlGui } from "./gui/server.js";
import { LlmProxy } from "./llm-proxy.js";
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

/**
 * Build upstream config from either string or object format.
 * String format: proxy.upstream = "https://api.anthropic.com", proxy.apiKey = "sk-..."
 * Object format: proxy.upstream = { anthropic: { url, apiKey }, openai: { url, apiKey } }
 */
function buildUpstreamConfig(proxyConfig: NonNullable<PluginConfig["proxy"]>): {
  anthropic?: { url: string; apiKey: string };
  openai?: { url: string; apiKey: string };
} {
  const upstream = proxyConfig.upstream;

  if (!upstream) return {};

  // String format: single upstream URL + flat apiKey
  if (typeof upstream === "string") {
    const apiKey = proxyConfig.apiKey ?? "";
    const url = upstream;
    // Guess provider from URL
    if (url.includes("anthropic")) {
      return { anthropic: { url, apiKey } };
    } else if (url.includes("openai")) {
      return { openai: { url, apiKey } };
    }
    // Default to anthropic
    return { anthropic: { url, apiKey } };
  }

  // Object format: multi-provider
  return {
    anthropic: upstream.anthropic ? {
      url: upstream.anthropic.url ?? "https://api.anthropic.com",
      apiKey: upstream.anthropic.apiKey,
    } : undefined,
    openai: upstream.openai ? {
      url: upstream.openai.url ?? "https://api.openai.com",
      apiKey: upstream.openai.apiKey,
    } : undefined,
  };
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

  // --- LLM Proxy: intercept tool calls at the API level ---
  const proxyConfig = config.proxy;

  const gui = new ControlGui({
    port: config.guiPort ?? 19820,
    aggregator,
    cedar,
    logger,
    proxyEnabled: !!proxyConfig?.enabled,
  });

  let proxy: LlmProxy | null = proxyConfig?.enabled ? new LlmProxy({
    port: proxyConfig.port ?? 19821,
    upstream: buildUpstreamConfig(proxyConfig),
    cedar,
    logger,
  }) : null;

  // --- Bypass detection: warn if built-in tools aren't denied ---
  const BYPASS_TOOLS = ["exec", "web_fetch", "web_search"];

  function checkForBypasses(): string[] {
    // Read OpenClaw config to check tools.deny
    try {
      const { readFileSync, existsSync } = require("node:fs");
      const { join } = require("node:path");
      const { homedir } = require("node:os");
      const configPath = join(homedir(), ".openclaw", "openclaw.json");
      if (!existsSync(configPath)) return BYPASS_TOOLS;
      const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
      const denied: string[] = cfg.tools?.deny ?? [];
      return BYPASS_TOOLS.filter((t) => !denied.includes(t));
    } catch {
      return BYPASS_TOOLS;
    }
  }

  function patchConfigDenyTools(): { patched: string[]; alreadyDenied: string[] } {
    const { readFileSync, writeFileSync, existsSync } = require("node:fs");
    const { join } = require("node:path");
    const { homedir } = require("node:os");
    const configPath = join(homedir(), ".openclaw", "openclaw.json");

    let cfg: any = {};
    if (existsSync(configPath)) {
      cfg = JSON.parse(readFileSync(configPath, "utf-8"));
    }

    if (!cfg.tools) cfg.tools = {};
    if (!cfg.tools.deny) cfg.tools.deny = [];

    const alreadyDenied = BYPASS_TOOLS.filter((t) => cfg.tools.deny.includes(t));
    const toAdd = BYPASS_TOOLS.filter((t) => !cfg.tools.deny.includes(t));

    for (const tool of toAdd) {
      cfg.tools.deny.push(tool);
    }

    if (toAdd.length > 0) {
      writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
    }

    return { patched: toAdd, alreadyDenied };
  }

  function backupConfig(): void {
    const { readFileSync, writeFileSync, existsSync, copyFileSync } = require("node:fs");
    const { join } = require("node:path");
    const { homedir } = require("node:os");
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    if (existsSync(configPath)) {
      const backupPath = configPath + ".carapace-backup";
      copyFileSync(configPath, backupPath);
    }
  }

  function patchConfigProxyBaseUrl(): { patched: string[]; alreadySet: string[] } {
    const { readFileSync, writeFileSync, existsSync } = require("node:fs");
    const { join } = require("node:path");
    const { homedir } = require("node:os");
    const configPath = join(homedir(), ".openclaw", "openclaw.json");

    if (!existsSync(configPath)) return { patched: [], alreadySet: [] };
    const cfg = JSON.parse(readFileSync(configPath, "utf-8"));

    const port = config.proxy?.port ?? 19821;
    const proxyUrl = `http://127.0.0.1:${port}`;

    // Figure out which providers are configured
    const upstreamConfig = proxyConfig ? buildUpstreamConfig(proxyConfig) : {};
    const providers = Object.keys(upstreamConfig).filter(
      (k) => upstreamConfig[k as keyof typeof upstreamConfig],
    );

    const patched: string[] = [];
    const alreadySet: string[] = [];

    if (!cfg.models) cfg.models = {};
    if (!cfg.models.mode) cfg.models.mode = "merge";
    if (!cfg.models.providers) cfg.models.providers = {};

    for (const provider of providers) {
      if (!cfg.models.providers[provider]) cfg.models.providers[provider] = {};
      // Ensure models array exists (OpenClaw requires it)
      if (!Array.isArray(cfg.models.providers[provider].models)) {
        cfg.models.providers[provider].models = [];
      }
      if (cfg.models.providers[provider].baseUrl === proxyUrl) {
        alreadySet.push(provider);
      } else {
        // Store original baseUrl for clean revert
        if (cfg.models.providers[provider].baseUrl && cfg.models.providers[provider].baseUrl !== proxyUrl) {
          cfg.models.providers[provider]._originalBaseUrl = cfg.models.providers[provider].baseUrl;
        }
        cfg.models.providers[provider].baseUrl = proxyUrl;
        patched.push(provider);
      }
    }

    // Ensure plugin config is under plugins.entries.carapace.config
    if (!cfg.plugins) cfg.plugins = {};
    if (!cfg.plugins.entries) cfg.plugins.entries = {};
    if (!cfg.plugins.entries.carapace) cfg.plugins.entries.carapace = {};
    if (!cfg.plugins.entries.carapace.config) cfg.plugins.entries.carapace.config = {};

    if (patched.length > 0 || !cfg.plugins.entries.carapace.enabled) {
      cfg.plugins.entries.carapace.enabled = true;
      writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
    }

    return { patched, alreadySet };
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

      if (proxy) {
        await proxy.start();

        // Health check: verify proxy is actually responding
        const proxyPort = proxyConfig!.port ?? 19821;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3000);
          const healthResp = await fetch(`http://127.0.0.1:${proxyPort}/health`, { signal: controller.signal });
          clearTimeout(timer);
          if (!healthResp.ok) throw new Error(`HTTP ${healthResp.status}`);
        } catch (err: any) {
          logger.error(`❌ Proxy health check failed on port ${proxyPort}: ${err.message}. Disabling proxy.`);
          try { await proxy.stop(); } catch {}
          proxy = null;
        }

        if (proxy) {
          logger.info(
            `🛡️  LLM Proxy active on http://127.0.0.1:${proxyPort} — ` +
            `all tool calls go through Cedar`
          );
        }
      } else {
        // Check for bypass vulnerabilities only when proxy is disabled
        const bypasses = checkForBypasses();
        if (bypasses.length > 0) {
          logger.warn(
            `⚠️  BYPASS RISK: Built-in tools [${bypasses.join(", ")}] are NOT denied and LLM proxy is not enabled. ` +
            `Agents can use these to bypass Carapace Cedar policies. ` +
            `Enable the LLM proxy (recommended) or run "openclaw carapace setup" to deny built-in tools.`
          );
        }
      }

      // Warn if Carapace is loaded but not actually enforcing anything
      const tools = aggregator.listTools();
      const enabledCount = tools.filter((t: any) => t.enabled).length;
      if (!proxy && enabledCount === 0) {
        logger.warn(
          `⚠️  Carapace is loaded but NOT ENFORCING. No tools are gated and the LLM proxy is disabled. ` +
          `Your agent is running without policy protection. ` +
          `Run "openclaw carapace setup" to activate enforcement, or configure policies at http://localhost:${config.guiPort ?? 19820}`
        );
      }
    },
    async stop() {
      if (proxy) await proxy.stop();
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
        console.log(`  GUI: http://localhost:${config.guiPort ?? 19820}`);

        if (proxy) {
          const stats = proxy.getStats();
          console.log(`\n  🛡️  LLM Proxy: http://127.0.0.1:${proxyConfig!.port ?? 19821}`);
          console.log(`  Requests: ${stats.requests} | Tool calls evaluated: ${stats.toolCallsEvaluated} | Denied: ${stats.toolCallsDenied}`);
        } else {
          console.log(`\n  ⚠️  LLM Proxy: disabled`);
        }
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
          for (const issue of result.issues) {
            console.log(`  - ${issue}`);
          }
        }
      });

      cmd.command("setup")
        .description("Configure OpenClaw to route all traffic through Carapace")
        .action(async () => {
          console.log("\n🦞 Carapace Setup\n");
          backupConfig();
          console.log("  📦 Backed up openclaw.json → openclaw.json.carapace-backup");
          let anyChanges = false;

          // 1. Deny built-in bypass tools
          const bypasses = checkForBypasses();
          if (bypasses.length > 0) {
            console.log("  Denying built-in tools that bypass Cedar:");
            const { patched, alreadyDenied } = patchConfigDenyTools();
            if (alreadyDenied.length > 0) {
              console.log(`    Already denied: ${alreadyDenied.join(", ")}`);
            }
            if (patched.length > 0) {
              console.log(`    ✅ Added to tools.deny: ${patched.join(", ")}`);
              anyChanges = true;
            }
          } else {
            console.log("  ✅ Built-in bypass tools already denied.");
          }

          // 2. Set up LLM proxy baseUrl if proxy is configured
          if (config.proxy?.enabled) {
            console.log("\n  Configuring LLM proxy baseUrl:");
            const { patched, alreadySet } = patchConfigProxyBaseUrl();
            if (alreadySet.length > 0) {
              console.log(`    Already set: ${alreadySet.join(", ")}`);
            }
            if (patched.length > 0) {
              console.log(`    ✅ Set models.providers baseUrl for: ${patched.join(", ")}`);
              anyChanges = true;
            }
            if (patched.length === 0 && alreadySet.length === 0) {
              console.log("    ⚠️  No upstream providers configured in proxy config.");
              console.log('       Set proxy.upstream to a URL string (e.g., "https://api.anthropic.com") with proxy.apiKey,');
              console.log("       or use the object format: proxy.upstream = { anthropic: { apiKey: '...' } }");
            }
          } else {
            console.log("\n  LLM proxy not enabled — skipping baseUrl setup.");
            console.log("  To enable, add proxy.enabled: true to your Carapace plugin config.");
          }

          if (anyChanges) {
            console.log("\n  Restart the gateway for changes to take effect:");
            console.log("    openclaw gateway restart\n");
          } else {
            console.log("\n  ✅ Everything already configured. No changes needed.\n");
          }
        });

      cmd.command("uninstall")
        .description("Reverse all config changes made by Carapace (restores built-in tools)")
        .action(async () => {
          console.log("\n🦞 Carapace Uninstall\n");
          console.log("  This reverses changes made by 'openclaw carapace setup'.\n");

          try {
            const { readFileSync, writeFileSync, existsSync } = require("node:fs");
            const { join } = require("node:path");
            const { homedir } = require("node:os");
            const configPath = join(homedir(), ".openclaw", "openclaw.json");

            if (!existsSync(configPath)) {
              console.log("  No config file found. Nothing to undo.\n");
              return;
            }

            const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
            let changed = false;

            // Remove Carapace-added entries from tools.deny
            if (cfg.tools?.deny) {
              const before = cfg.tools.deny.length;
              cfg.tools.deny = cfg.tools.deny.filter((t: string) => !BYPASS_TOOLS.includes(t));
              if (cfg.tools.deny.length === 0) delete cfg.tools.deny;
              if (cfg.tools && Object.keys(cfg.tools).length === 0) delete cfg.tools;
              if (cfg.tools?.deny?.length !== before) {
                changed = true;
                console.log(`  ✅ Removed [${BYPASS_TOOLS.join(", ")}] from tools.deny`);
                console.log("     Built-in exec, web_fetch, and web_search are restored.");
              }
            }

            // Remove models.providers baseUrl override if it points at the proxy
            const proxyPort = cfg.plugins?.entries?.carapace?.config?.proxy?.port ?? 19821;
            const proxyUrl = `http://127.0.0.1:${proxyPort}`;
            if (cfg.models?.providers) {
              for (const [name, provCfg] of Object.entries(cfg.models.providers)) {
                if ((provCfg as any)?.baseUrl === proxyUrl) {
                  // Restore original baseUrl if stored
                  if ((provCfg as any)._originalBaseUrl) {
                    (provCfg as any).baseUrl = (provCfg as any)._originalBaseUrl;
                    delete (provCfg as any)._originalBaseUrl;
                    console.log(`  ✅ Restored original baseUrl for ${name}`);
                  } else {
                    delete (provCfg as any).baseUrl;
                    console.log(`  ✅ Removed baseUrl proxy override for ${name}`);
                  }
                  // Clean up empty objects
                  if (Object.keys(provCfg as any).length === 0) delete cfg.models.providers[name];
                  changed = true;
                  console.log(`     ${name} will connect directly to its API again.`);
                }
              }
              if (Object.keys(cfg.models.providers).length === 0) delete cfg.models.providers;
              if (cfg.models && Object.keys(cfg.models).length === 0) delete cfg.models;
            }

            // Disable the plugin entry (don't delete — user might want to re-enable)
            if (cfg.plugins?.entries?.carapace?.enabled) {
              cfg.plugins.entries.carapace.enabled = false;
              changed = true;
              console.log("  ✅ Disabled carapace plugin in config");
            }

            if (changed) {
              writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
              console.log("\n  Config updated. Restart the gateway for changes to take effect:");
              console.log("    openclaw gateway restart\n");
              console.log("  To fully remove the plugin files:");
              console.log("    rm -rf ~/.openclaw/extensions/carapace\n");
            } else {
              console.log("  No Carapace changes found in config. Nothing to undo.\n");
            }


          } catch (err: any) {
            console.log(`  ❌ Error: ${err.message}\n`);
          }
        });

      cmd.command("check")
        .description("Check for bypass vulnerabilities (built-in tools that skip Cedar)")
        .action(async () => {
          console.log("\n🦞 Carapace Security Check\n");
          const bypasses = checkForBypasses();
          if (bypasses.length === 0) {
            console.log("  ✅ No bypass vulnerabilities found.");
            console.log("  All agent exec/fetch operations go through Cedar.\n");
          } else {
            console.log("  ⚠️  Bypass vulnerabilities found:\n");
            for (const tool of bypasses) {
              console.log(`    🔓 ${tool} — agents can bypass Cedar policies via this tool`);
            }
            console.log(`\n  Run "openclaw carapace setup" to fix.\n`);
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
