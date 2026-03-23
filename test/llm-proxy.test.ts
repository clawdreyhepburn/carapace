/**
 * Unit tests for LlmProxy — the security-critical component that intercepts
 * LLM responses, evaluates tool_use blocks against Cedar policies, and strips denied calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LlmProxy, type LlmProxyOpts } from "../src/llm-proxy.js";

// ── Mock Cedar authorizer ──

function mockCedar(decisions: Record<string, "allow" | "deny"> = {}) {
  const defaultDecision = "allow" as const;
  const calls: Array<{ principal: string; action: string; resource: string; context?: Record<string, unknown> }> = [];

  return {
    calls,
    authorizer: {
      authorize: vi.fn(async (req: { principal: string; action: string; resource: string; context?: Record<string, unknown> }) => {
        calls.push(req);
        // Match by resource ID extracted from resource string
        for (const [pattern, decision] of Object.entries(decisions)) {
          if (req.resource.includes(pattern)) {
            return { decision, reasons: [`test: ${decision} ${pattern}`] };
          }
        }
        return { decision: defaultDecision, reasons: ["test: default allow"] };
      }),
    },
  };
}

const logger: LlmProxyOpts["logger"] = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// ── Helper: make a non-streaming Anthropic request to the proxy ──

async function postMessages(proxyPort: number, body: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "test-key",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<any>;
}

// ── Helper: create fake upstream that returns a fixed response ──

function createFakeUpstream(response: any): Promise<{ port: number; server: ReturnType<typeof import("node:http").createServer> }> {
  const { createServer } = require("node:http");
  return new Promise((resolve) => {
    const server = createServer((_req: any, res: any) => {
      let body = "";
      _req.on("data", (c: Buffer) => (body += c));
      _req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      resolve({ port: addr.port, server });
    });
  });
}

// ── Helper: create streaming fake upstream ──

function createFakeStreamingUpstream(events: Array<{ event: string; data: any }>): Promise<{ port: number; server: ReturnType<typeof import("node:http").createServer> }> {
  const { createServer } = require("node:http");
  return new Promise((resolve) => {
    const server = createServer((_req: any, res: any) => {
      let body = "";
      _req.on("data", (c: Buffer) => (body += c));
      _req.on("end", () => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        for (const ev of events) {
          if (ev.event) res.write(`event: ${ev.event}\n`);
          res.write(`data: ${JSON.stringify(ev.data)}\n\n`);
        }
        res.end();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      resolve({ port: addr.port, server });
    });
  });
}

// Use dynamic ports to avoid collisions
let nextPort = 29100;
function getPort() { return nextPort++; }

// ── Anthropic response builders ──

function anthropicResponse(content: any[], stopReason = "tool_use") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-test",
    stop_reason: stopReason,
    content,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

function toolUseBlock(id: string, name: string, input: Record<string, unknown>) {
  return { type: "tool_use", id, name, input };
}

function textBlock(text: string) {
  return { type: "text", text };
}

// ══════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════

describe("LlmProxy", () => {

  // 1. Parse tool_use from response
  it("parses tool_use blocks and passes them through when all allowed", async () => {
    const cedar = mockCedar({});
    const upstream = await createFakeUpstream(
      anthropicResponse([
        textBlock("Here are the results."),
        toolUseBlock("toolu_1", "exec", { command: "ls /tmp" }),
      ])
    );
    const proxyPort = getPort();
    const proxy = new LlmProxy({
      port: proxyPort,
      upstream: { anthropic: { url: `http://127.0.0.1:${upstream.port}`, apiKey: "fake" } },
      cedar: cedar.authorizer,
      logger,
    });
    await proxy.start();

    try {
      const result = await postMessages(proxyPort, {
        model: "claude-test", max_tokens: 100,
        messages: [{ role: "user", content: "test" }],
      });

      const tools = result.content.filter((b: any) => b.type === "tool_use");
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("exec");
      expect(tools[0].id).toBe("toolu_1");
    } finally {
      await proxy.stop();
      upstream.server.close();
    }
  });

  // 2. Strip denied tool call — one permitted, one denied
  it("strips denied tool call and keeps permitted one", async () => {
    const cedar = mockCedar({ "rm": "deny" }); // rm denied, ls allowed
    const upstream = await createFakeUpstream(
      anthropicResponse([
        toolUseBlock("toolu_rm", "exec", { command: "rm -rf /" }),
        toolUseBlock("toolu_ls", "exec", { command: "ls /tmp" }),
      ])
    );
    const proxyPort = getPort();
    const proxy = new LlmProxy({
      port: proxyPort,
      upstream: { anthropic: { url: `http://127.0.0.1:${upstream.port}`, apiKey: "fake" } },
      cedar: cedar.authorizer,
      logger,
    });
    await proxy.start();

    try {
      const result = await postMessages(proxyPort, {
        model: "claude-test", max_tokens: 100,
        messages: [{ role: "user", content: "test" }],
      });

      const tools = result.content.filter((b: any) => b.type === "tool_use");
      const denials = result.content.filter((b: any) => b.type === "text" && b.text.includes("DENIED"));

      expect(tools).toHaveLength(1);
      expect(tools[0].input.command).toBe("ls /tmp");
      expect(denials).toHaveLength(1);
      expect(denials[0].text).toContain("exec");
    } finally {
      await proxy.stop();
      upstream.server.close();
    }
  });

  // 3. Allow all when no denies
  it("passes response through unchanged when all tools are permitted", async () => {
    const cedar = mockCedar({}); // all allowed
    const content = [
      textBlock("Running commands."),
      toolUseBlock("t1", "exec", { command: "ls" }),
      toolUseBlock("t2", "exec", { command: "git status" }),
    ];
    const upstream = await createFakeUpstream(anthropicResponse(content));
    const proxyPort = getPort();
    const proxy = new LlmProxy({
      port: proxyPort,
      upstream: { anthropic: { url: `http://127.0.0.1:${upstream.port}`, apiKey: "fake" } },
      cedar: cedar.authorizer,
      logger,
    });
    await proxy.start();

    try {
      const result = await postMessages(proxyPort, {
        model: "claude-test", max_tokens: 100,
        messages: [{ role: "user", content: "test" }],
      });

      const tools = result.content.filter((b: any) => b.type === "tool_use");
      expect(tools).toHaveLength(2);
      expect(result.stop_reason).toBe("tool_use");
    } finally {
      await proxy.stop();
      upstream.server.close();
    }
  });

  // 4. Strip all when all denied
  it("strips all tool_use blocks when all are denied and fixes stop_reason", async () => {
    const cedar = mockCedar({ "Shell": "deny", "API": "deny", "Tool": "deny" });
    const upstream = await createFakeUpstream(
      anthropicResponse([
        toolUseBlock("t1", "exec", { command: "rm -rf /" }),
        toolUseBlock("t2", "web_fetch", { url: "https://evil.com" }),
      ])
    );
    const proxyPort = getPort();
    const proxy = new LlmProxy({
      port: proxyPort,
      upstream: { anthropic: { url: `http://127.0.0.1:${upstream.port}`, apiKey: "fake" } },
      cedar: cedar.authorizer,
      logger,
    });
    await proxy.start();

    try {
      const result = await postMessages(proxyPort, {
        model: "claude-test", max_tokens: 100,
        messages: [{ role: "user", content: "test" }],
      });

      const tools = result.content.filter((b: any) => b.type === "tool_use");
      const denials = result.content.filter((b: any) => b.type === "text" && b.text.includes("DENIED"));

      expect(tools).toHaveLength(0);
      expect(denials).toHaveLength(2);
      expect(result.stop_reason).toBe("end_turn"); // fixed from tool_use
    } finally {
      await proxy.stop();
      upstream.server.close();
    }
  });

  // 5. Handle streaming — buffers, filters, re-streams
  it("buffers streaming response, filters denied tools, re-streams", async () => {
    const cedar = mockCedar({ "rm": "deny" });
    const sseEvents = [
      { event: "message_start", data: { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-test", stop_reason: null, content: [] } } },
      { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_rm", name: "exec" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"command":' } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"rm -rf /"}' } } },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
      { event: "content_block_start", data: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_ls", name: "exec" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command":"ls /tmp"}' } } },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
      { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 50 } } },
      { event: "message_stop", data: { type: "message_stop" } },
    ];

    const upstream = await createFakeStreamingUpstream(sseEvents);
    const proxyPort = getPort();
    const proxy = new LlmProxy({
      port: proxyPort,
      upstream: { anthropic: { url: `http://127.0.0.1:${upstream.port}`, apiKey: "fake" } },
      cedar: cedar.authorizer,
      logger,
    });
    await proxy.start();

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-test", max_tokens: 100, stream: true,
          messages: [{ role: "user", content: "test" }],
        }),
      });

      const text = await res.text();
      // The rm tool should be replaced with a denial text block
      expect(text).toContain("DENIED");
      // The ls tool should still be present
      expect(text).toContain("toolu_ls");
    } finally {
      await proxy.stop();
      upstream.server.close();
    }
  });

  // 6. Handle response with no tool_use — plain text passes through unchanged
  it("passes plain text response through unchanged", async () => {
    const cedar = mockCedar({});
    const upstream = await createFakeUpstream(
      anthropicResponse([textBlock("Hello, I can help you with that.")], "end_turn")
    );
    const proxyPort = getPort();
    const proxy = new LlmProxy({
      port: proxyPort,
      upstream: { anthropic: { url: `http://127.0.0.1:${upstream.port}`, apiKey: "fake" } },
      cedar: cedar.authorizer,
      logger,
    });
    await proxy.start();

    try {
      const result = await postMessages(proxyPort, {
        model: "claude-test", max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toBe("Hello, I can help you with that.");
      expect(result.stop_reason).toBe("end_turn");
      // Cedar should NOT have been called (no tool_use blocks)
      expect(cedar.authorizer.authorize).not.toHaveBeenCalled();
    } finally {
      await proxy.stop();
      upstream.server.close();
    }
  });

  // 7. Handle malformed tool_use — gracefully handle
  it("handles malformed tool_use block gracefully", async () => {
    const cedar = mockCedar({});
    const upstream = await createFakeUpstream(
      anthropicResponse([
        textBlock("Let me try."),
        { type: "tool_use", id: "bad", name: undefined, input: "not-an-object" },
        toolUseBlock("good", "exec", { command: "echo hi" }),
      ])
    );
    const proxyPort = getPort();
    const proxy = new LlmProxy({
      port: proxyPort,
      upstream: { anthropic: { url: `http://127.0.0.1:${upstream.port}`, apiKey: "fake" } },
      cedar: cedar.authorizer,
      logger,
    });
    await proxy.start();

    try {
      const result = await postMessages(proxyPort, {
        model: "claude-test", max_tokens: 100,
        messages: [{ role: "user", content: "test" }],
      });

      // Should not crash — the good tool call should still be present
      const tools = result.content.filter((b: any) => b.type === "tool_use");
      expect(tools.length).toBeGreaterThanOrEqual(1);
    } finally {
      await proxy.stop();
      upstream.server.close();
    }
  });

  // 8. Cedar evaluation called for each tool
  it("calls Cedar authorize once per tool_use block", async () => {
    const cedar = mockCedar({});
    const upstream = await createFakeUpstream(
      anthropicResponse([
        toolUseBlock("t1", "exec", { command: "ls" }),
        toolUseBlock("t2", "web_fetch", { url: "https://example.com" }),
        toolUseBlock("t3", "exec", { command: "git status" }),
      ])
    );
    const proxyPort = getPort();
    const proxy = new LlmProxy({
      port: proxyPort,
      upstream: { anthropic: { url: `http://127.0.0.1:${upstream.port}`, apiKey: "fake" } },
      cedar: cedar.authorizer,
      logger,
    });
    await proxy.start();

    try {
      await postMessages(proxyPort, {
        model: "claude-test", max_tokens: 100,
        messages: [{ role: "user", content: "test" }],
      });

      expect(cedar.authorizer.authorize).toHaveBeenCalledTimes(3);
      // Verify calls were made with correct resource types
      const resources = cedar.calls.map(c => c.resource);
      expect(resources.some(r => r.includes("Shell"))).toBe(true); // exec → Shell
      expect(resources.some(r => r.includes("API"))).toBe(true);   // web_fetch → API
    } finally {
      await proxy.stop();
      upstream.server.close();
    }
  });

  // Bonus: audit log is populated
  it("populates audit log with decisions", async () => {
    const cedar = mockCedar({ "rm": "deny" });
    const upstream = await createFakeUpstream(
      anthropicResponse([
        toolUseBlock("t1", "exec", { command: "rm -rf /" }),
        toolUseBlock("t2", "exec", { command: "ls" }),
      ])
    );
    const proxyPort = getPort();
    const proxy = new LlmProxy({
      port: proxyPort,
      upstream: { anthropic: { url: `http://127.0.0.1:${upstream.port}`, apiKey: "fake" } },
      cedar: cedar.authorizer,
      logger,
    });
    await proxy.start();

    try {
      await postMessages(proxyPort, {
        model: "claude-test", max_tokens: 100,
        messages: [{ role: "user", content: "test" }],
      });

      const log = proxy.getAuditLog();
      expect(log).toHaveLength(2);
      expect(log.some(e => e.decision === "deny")).toBe(true);
      expect(log.some(e => e.decision === "allow")).toBe(true);
    } finally {
      await proxy.stop();
      upstream.server.close();
    }
  });
});
