/**
 * LLM Proxy — Sits between OpenClaw and the LLM provider.
 *
 * Intercepts tool_use blocks in LLM responses and evaluates them
 * against Cedar policies before OpenClaw can execute them.
 *
 * The agent never gets the real API key. Carapace holds it.
 * Denied tool calls are replaced with text blocks explaining why.
 *
 * Supports:
 * - Anthropic Messages API (/v1/messages)
 * - OpenAI Chat Completions API (/v1/chat/completions)
 * - Both streaming and non-streaming (streaming is buffered, filtered, re-streamed)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Logger } from "./types.js";

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface TextBlock {
  type: "text";
  text: string;
}

type ContentBlock = ToolUseBlock | TextBlock | { type: string; [key: string]: unknown };

interface CedarAuthorizer {
  authorize(request: {
    principal: string;
    action: string;
    resource: string;
    context?: Record<string, unknown>;
  }): Promise<{ decision: "allow" | "deny"; reasons: string[] }>;
}

export interface LlmProxyOpts {
  port: number;
  upstream: {
    anthropic?: { url: string; apiKey: string };
    openai?: { url: string; apiKey: string };
  };
  cedar: CedarAuthorizer;
  logger: Logger;
}

export class LlmProxy {
  private server: ReturnType<typeof createServer> | null = null;
  private port: number;
  private upstream: LlmProxyOpts["upstream"];
  private cedar: CedarAuthorizer;
  private logger: Logger;

  // Stats
  private stats = {
    requests: 0,
    toolCallsEvaluated: 0,
    toolCallsDenied: 0,
  };

  constructor(opts: LlmProxyOpts) {
    this.port = opts.port;
    this.upstream = opts.upstream;
    this.cedar = opts.cedar;
    this.logger = opts.logger;
  }

  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      try {
        await this.handleRequest(req, res);
      } catch (err: any) {
        this.logger.error(`LLM Proxy error: ${err.message}`);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: `Carapace proxy error: ${err.message}` } }));
      }
    });

    return new Promise((resolve) => {
      this.server!.listen(this.port, "127.0.0.1", () => {
        this.logger.info(`LLM Proxy listening on http://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => resolve());
    });
  }

  getStats() {
    return { ...this.stats };
  }

  // ── Request handling ──

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.stats.requests++;
    const path = req.url ?? "/";

    // Health check
    if (path === "/health" || path === "/carapace/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, stats: this.stats }));
      return;
    }

    // Detect provider from path
    if (path.startsWith("/v1/messages")) {
      await this.proxyAnthropic(req, res);
    } else if (path.startsWith("/v1/chat/completions")) {
      await this.proxyOpenAI(req, res);
    } else {
      // Pass through unknown paths (models list, etc.)
      await this.passthrough(req, res, path);
    }
  }

  // ── Anthropic Messages API ──

  private async proxyAnthropic(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const upstream = this.upstream.anthropic;
    if (!upstream) {
      res.writeHead(501, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Anthropic upstream not configured" } }));
      return;
    }

    const body = await this.readBody(req);
    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid JSON body" } }));
      return;
    }

    const isStreaming = parsed.stream === true;

    // Forward to Anthropic (always non-streaming for filtering)
    const upstreamResponse = await this.forwardToAnthropic(upstream, body, req, isStreaming);

    if (!upstreamResponse.ok) {
      // Forward error as-is
      const errorBody = await upstreamResponse.text();
      res.writeHead(upstreamResponse.status, {
        "Content-Type": upstreamResponse.headers.get("content-type") ?? "application/json",
      });
      res.end(errorBody);
      return;
    }

    if (isStreaming) {
      await this.handleAnthropicStreaming(upstreamResponse, res);
    } else {
      await this.handleAnthropicNonStreaming(upstreamResponse, res);
    }
  }

  private async forwardToAnthropic(
    upstream: { url: string; apiKey: string },
    body: string,
    req: IncomingMessage,
    isStreaming: boolean,
  ): Promise<Response> {
    // Build headers, replacing auth
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": upstream.apiKey,
      "anthropic-version": (req.headers["anthropic-version"] as string) ?? "2023-06-01",
    };

    // Forward anthropic-beta if present
    const beta = req.headers["anthropic-beta"];
    if (beta) headers["anthropic-beta"] = beta as string;

    return fetch(`${upstream.url}/v1/messages`, {
      method: "POST",
      headers,
      body,
    });
  }

  private async handleAnthropicNonStreaming(upstreamResponse: Response, res: ServerResponse): Promise<void> {
    const responseBody = await upstreamResponse.text();
    let parsed: any;
    try {
      parsed = JSON.parse(responseBody);
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(responseBody);
      return;
    }

    // Filter tool_use blocks
    if (parsed.content && Array.isArray(parsed.content)) {
      parsed.content = await this.filterContentBlocks(parsed.content);

      // Update stop_reason if all tool_use blocks were denied
      const hasToolUse = parsed.content.some((b: any) => b.type === "tool_use");
      if (!hasToolUse && parsed.stop_reason === "tool_use") {
        parsed.stop_reason = "end_turn";
      }
    }

    const filtered = JSON.stringify(parsed);
    res.writeHead(200, {
      "Content-Type": "application/json",
    });
    res.end(filtered);
  }

  private async handleAnthropicStreaming(upstreamResponse: Response, res: ServerResponse): Promise<void> {
    // Buffer the full streaming response, then filter and re-stream
    const reader = upstreamResponse.body?.getReader();
    if (!reader) {
      res.writeHead(502);
      res.end();
      return;
    }

    // Collect all SSE events
    const decoder = new TextDecoder();
    let buffer = "";
    const events: Array<{ event: string; data: string }> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep incomplete line

      let currentEvent = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          events.push({ event: currentEvent, data: line.slice(6) });
          currentEvent = "";
        }
      }
    }

    // Find tool_use content blocks and evaluate them
    const toolBlocks = new Map<number, { name: string; inputJson: string; id: string }>();
    const deniedIndices = new Set<number>();
    let currentBlockIndex = -1;

    for (const ev of events) {
      if (ev.event === "content_block_start") {
        try {
          const d = JSON.parse(ev.data);
          currentBlockIndex = d.index ?? -1;
          if (d.content_block?.type === "tool_use") {
            toolBlocks.set(currentBlockIndex, {
              name: d.content_block.name,
              id: d.content_block.id,
              inputJson: "",
            });
          }
        } catch {}
      } else if (ev.event === "content_block_delta") {
        try {
          const d = JSON.parse(ev.data);
          const idx = d.index ?? currentBlockIndex;
          const block = toolBlocks.get(idx);
          if (block && d.delta?.type === "input_json_delta") {
            block.inputJson += d.delta.partial_json ?? "";
          }
        } catch {}
      }
    }

    // Evaluate each tool call against Cedar
    for (const [idx, block] of toolBlocks) {
      const decision = await this.evaluateToolCall(block.name, block.inputJson);
      if (decision === "deny") {
        deniedIndices.add(idx);
        this.logger.info(`LLM Proxy DENIED tool call: ${block.name} (block ${idx})`);
      }
    }

    if (deniedIndices.size === 0) {
      // No denials — forward everything as-is
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      for (const ev of events) {
        if (ev.event) res.write(`event: ${ev.event}\n`);
        res.write(`data: ${ev.data}\n\n`);
      }
      res.end();
      return;
    }

    // Rewrite stream: replace denied tool blocks with text blocks
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    let skipBlock = false;
    let skipBlockIndex = -1;

    for (const ev of events) {
      if (ev.event === "content_block_start") {
        try {
          const d = JSON.parse(ev.data);
          const idx = d.index ?? -1;
          if (deniedIndices.has(idx)) {
            skipBlock = true;
            skipBlockIndex = idx;
            const block = toolBlocks.get(idx)!;
            // Emit a text block instead
            const replacement = {
              index: idx,
              content_block: {
                type: "text",
                text: "",
              },
            };
            res.write(`event: content_block_start\ndata: ${JSON.stringify(replacement)}\n\n`);
            // Emit the denial text as a delta
            const denialText = `\n🚫 DENIED by Cedar policy: ${block.name}\n`;
            const delta = {
              index: idx,
              delta: { type: "text_delta", text: denialText },
            };
            res.write(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`);
            continue;
          }
        } catch {}
        skipBlock = false;
      }

      if (ev.event === "content_block_delta") {
        try {
          const d = JSON.parse(ev.data);
          if (deniedIndices.has(d.index ?? skipBlockIndex)) continue;
        } catch {}
      }

      if (ev.event === "content_block_stop") {
        try {
          const d = JSON.parse(ev.data);
          if (deniedIndices.has(d.index ?? skipBlockIndex)) {
            // Emit the stop for our replacement text block
            res.write(`event: content_block_stop\ndata: ${ev.data}\n\n`);
            skipBlock = false;
            continue;
          }
        } catch {}
      }

      if (skipBlock) continue;

      // Fix message_delta stop_reason if all tools were denied
      if (ev.event === "message_delta") {
        try {
          const d = JSON.parse(ev.data);
          const remainingTools = [...toolBlocks.keys()].filter((i) => !deniedIndices.has(i));
          if (remainingTools.length === 0 && d.delta?.stop_reason === "tool_use") {
            d.delta.stop_reason = "end_turn";
            res.write(`event: message_delta\ndata: ${JSON.stringify(d)}\n\n`);
            continue;
          }
        } catch {}
      }

      // Forward event as-is
      if (ev.event) res.write(`event: ${ev.event}\n`);
      res.write(`data: ${ev.data}\n\n`);
    }

    res.end();
  }

  // ── OpenAI Chat Completions API ──

  private async proxyOpenAI(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const upstream = this.upstream.openai;
    if (!upstream) {
      res.writeHead(501, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "OpenAI upstream not configured" } }));
      return;
    }

    const body = await this.readBody(req);
    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid JSON body" } }));
      return;
    }

    const isStreaming = parsed.stream === true;

    // For streaming: force non-streaming, filter, then re-stream
    const forwardBody = isStreaming ? JSON.stringify({ ...parsed, stream: false }) : body;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${upstream.apiKey}`,
    };

    const upstreamResponse = await fetch(`${upstream.url}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: forwardBody,
    });

    if (!upstreamResponse.ok) {
      const errorBody = await upstreamResponse.text();
      res.writeHead(upstreamResponse.status, { "Content-Type": "application/json" });
      res.end(errorBody);
      return;
    }

    const responseBody = await upstreamResponse.text();
    let response: any;
    try {
      response = JSON.parse(responseBody);
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(responseBody);
      return;
    }

    // Filter tool_calls from choices
    if (response.choices) {
      for (const choice of response.choices) {
        if (choice.message?.tool_calls) {
          const filtered = [];
          const denials: string[] = [];

          for (const tc of choice.message.tool_calls) {
            const decision = await this.evaluateToolCall(
              tc.function?.name ?? tc.name,
              typeof tc.function?.arguments === "string"
                ? tc.function.arguments
                : JSON.stringify(tc.function?.arguments ?? {}),
            );

            if (decision === "allow") {
              filtered.push(tc);
            } else {
              denials.push(
                `🚫 DENIED by Cedar policy: ${tc.function?.name ?? tc.name}`,
              );
              this.logger.info(`LLM Proxy DENIED tool call: ${tc.function?.name}`);
            }
          }

          choice.message.tool_calls = filtered.length > 0 ? filtered : undefined;

          // Add denial messages to content
          if (denials.length > 0) {
            const existing = choice.message.content ?? "";
            choice.message.content = (existing + "\n" + denials.join("\n")).trim();
          }

          // Fix finish_reason if all tool calls were denied
          if (filtered.length === 0 && choice.finish_reason === "tool_calls") {
            choice.finish_reason = "stop";
          }
        }
      }
    }

    if (isStreaming) {
      // Re-stream as SSE (single chunk since we forced non-streaming)
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      // Convert to streaming format
      const chunk = { ...response, object: "chat.completion.chunk" };
      for (const choice of chunk.choices ?? []) {
        choice.delta = choice.message;
        delete choice.message;
      }
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    }
  }

  // ── Passthrough for non-chat endpoints ──

  private async passthrough(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    // Try Anthropic first, then OpenAI
    const upstream = this.upstream.anthropic ?? this.upstream.openai;
    if (!upstream) {
      res.writeHead(501);
      res.end();
      return;
    }

    const body = req.method !== "GET" ? await this.readBody(req) : undefined;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.upstream.anthropic) {
      headers["x-api-key"] = upstream.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${upstream.apiKey}`;
    }

    const response = await fetch(`${upstream.url}${path}`, {
      method: req.method ?? "GET",
      headers,
      body,
    });

    const responseBody = await response.text();
    res.writeHead(response.status, {
      "Content-Type": response.headers.get("content-type") ?? "application/json",
    });
    res.end(responseBody);
  }

  // ── Cedar evaluation ──

  private async evaluateToolCall(toolName: string, inputJson: string): Promise<"allow" | "deny"> {
    this.stats.toolCallsEvaluated++;

    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = JSON.parse(inputJson || "{}");
    } catch {}

    // Determine resource type based on tool name
    let resourceType = "Tool";
    let action = "call_tool";
    let resourceId = toolName;
    let context: Record<string, unknown> = {};

    // Map known OpenClaw built-in tools to resource types
    if (toolName === "exec" || toolName === "process") {
      resourceType = "Shell";
      action = "exec_command";
      // Extract binary name from the command argument
      const cmd = (parsedInput.command as string) ?? "";
      resourceId = cmd.trim().split(/\s+/)[0]?.replace(/^.*\//, "") || toolName;
      // Map to schema-known context attributes
      context = {
        args: cmd,
        workdir: (parsedInput.workdir as string) ?? "",
      };
    } else if (toolName === "web_fetch" || toolName === "web_search") {
      resourceType = "API";
      action = "call_api";
      // Extract domain from URL
      const url = (parsedInput.url as string) ?? (parsedInput.query as string) ?? "";
      try {
        if (url.startsWith("http")) {
          resourceId = new URL(url).hostname;
        } else {
          resourceId = toolName;
        }
      } catch {
        resourceId = toolName;
      }
      // Map to schema-known context attributes
      context = {
        url,
        method: (parsedInput.method as string) ?? "GET",
        body: (parsedInput.body as string) ?? "",
      };
    }

    const decision = await this.cedar.authorize({
      principal: `Agent::"openclaw"`,
      action: `Action::"${action}"`,
      resource: `${resourceType}::"${resourceId}"`,
      context,
    });

    if (decision.decision === "deny") {
      this.stats.toolCallsDenied++;
    }

    return decision.decision;
  }

  // ── Content block filtering (Anthropic non-streaming) ──

  private async filterContentBlocks(blocks: ContentBlock[]): Promise<ContentBlock[]> {
    const result: ContentBlock[] = [];

    for (const block of blocks) {
      if (block.type !== "tool_use") {
        result.push(block);
        continue;
      }

      const toolBlock = block as ToolUseBlock;
      const decision = await this.evaluateToolCall(
        toolBlock.name,
        JSON.stringify(toolBlock.input),
      );

      if (decision === "allow") {
        result.push(block);
      } else {
        // Replace with denial text
        result.push({
          type: "text",
          text: `\n🚫 DENIED by Cedar policy: ${toolBlock.name}\n`,
        });
        this.logger.info(`LLM Proxy DENIED tool call: ${toolBlock.name}`);
      }
    }

    return result;
  }

  // ── Utilities ──

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      req.on("error", reject);
    });
  }
}
