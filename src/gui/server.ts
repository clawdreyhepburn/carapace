/**
 * Control GUI — lightweight local web server for human oversight of MCP tool access.
 *
 * Serves a single-page app that shows all MCP servers and tools,
 * lets humans toggle access, and displays Cedar policy state.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { McpAggregator } from "../mcp-aggregator.js";
import type { Logger, CedarEngineInterface } from "../types.js";
import { guiHtml } from "./html.js";

interface GuiOpts {
  port: number;
  aggregator: McpAggregator;
  cedar: CedarEngineInterface;
  logger: Logger;
  proxyEnabled?: boolean;
}

export class ControlGui {
  private port: number;
  private aggregator: McpAggregator;
  private cedar: CedarEngineInterface;
  private logger: Logger;
  private server: Server | null = null;
  private proxyEnabled: boolean;

  constructor(opts: GuiOpts) {
    this.port = opts.port;
    this.aggregator = opts.aggregator;
    this.cedar = opts.cedar;
    this.logger = opts.logger;
    this.proxyEnabled = opts.proxyEnabled ?? false;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, "127.0.0.1", () => {
        this.logger.info(`GUI listening on http://127.0.0.1:${this.port}`);
        resolve();
      });
      this.server!.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);

    try {
      // --- API routes ---
      if (url.pathname === "/api/status" && req.method === "GET") {
        const servers = this.aggregator.getServerStatus();
        const tools = this.aggregator.listTools();
        const enabledCount = tools.filter((t) => t.enabled).length;
        this.json(res, {
          servers,
          tools,
          policies: this.cedar.getPolicies(),
          toolCount: tools.length,
          enabledCount,
          defaultPolicy: this.cedar.getDefaultPolicy?.() ?? "allow-all",
          proxyEnabled: this.proxyEnabled,
          notEnforcing: !this.proxyEnabled && enabledCount === 0,
        });
        return;
      }

      if (url.pathname === "/api/tools" && req.method === "GET") {
        const server = url.searchParams.get("server") ?? undefined;
        this.json(res, this.aggregator.listTools(server));
        return;
      }

      if (url.pathname === "/api/toggle" && req.method === "POST") {
        const body = await this.readBody(req);
        const { tool, enabled } = JSON.parse(body);
        if (enabled) {
          this.cedar.enableTool(tool);
        } else {
          this.cedar.disableTool(tool);
        }
        this.json(res, { ok: true, tool, enabled });
        return;
      }

      if (url.pathname === "/api/verify" && req.method === "POST") {
        const result = await this.cedar.verify();
        this.json(res, result);
        return;
      }

      if (url.pathname === "/api/policies" && req.method === "GET") {
        this.json(res, this.cedar.getPolicies());
        return;
      }

      if (url.pathname === "/api/policy" && req.method === "POST") {
        const body = await this.readBody(req);
        const { id, raw } = JSON.parse(body);
        if (!id || !raw) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "id and raw are required" }));
          return;
        }
        this.cedar.savePolicy(id, raw);
        this.json(res, { ok: true, id });
        return;
      }

      if (url.pathname === "/api/policy" && req.method === "DELETE") {
        const body = await this.readBody(req);
        const { id } = JSON.parse(body);
        const deleted = this.cedar.deletePolicy(id);
        this.json(res, { ok: deleted, id });
        return;
      }

      if (url.pathname === "/api/schema" && req.method === "GET") {
        this.json(res, this.cedar.getSchema());
        return;
      }

      if (url.pathname === "/api/schema" && req.method === "POST") {
        const body = await this.readBody(req);
        const { raw } = JSON.parse(body);
        this.cedar.saveSchema(raw);
        this.json(res, { ok: true });
        return;
      }

      // --- GUI ---
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(guiHtml());
        return;
      }

      // 404
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } catch (err: any) {
      this.logger.error(`GUI error: ${err.message}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  private json(res: ServerResponse, data: any): void {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(data));
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      req.on("error", reject);
    });
  }
}
