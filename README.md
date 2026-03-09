# MCP Cedar Proxy

An [OpenClaw](https://github.com/openclaw/openclaw) plugin that aggregates MCP (Model Context Protocol) servers and enforces tool access with [Cedar](https://www.cedarpolicy.com/) authorization policies.

## What it does

- **Aggregates MCP servers** — connects to multiple upstream MCP servers (stdio, HTTP/SSE, streamable HTTP) and discovers their tools, resources, and prompts
- **Cedar policy enforcement** — every tool invocation is authorized by Cedar policies before reaching the upstream server
- **Local control GUI** — a web dashboard where humans see all discovered servers and tools, and toggle access on/off
- **Formal verification** — optional integration with cvc5 SMT solver to prove your tool access policies are consistent and complete
- **OpenClaw agent tool** — registers tools so your OpenClaw agent can discover and invoke MCP tools through the proxy

## Why

MCP gives agents access to tools. But who decides which tools an agent can use? Today the answer is "whatever's in the config file" — a static, all-or-nothing list with no audit trail and no formal guarantees.

This plugin puts Cedar between your agent and its tools. Cedar policies are declarative, auditable, and formally verifiable. The GUI makes it accessible to humans who don't want to write policy files by hand.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  OpenClaw   │────▶│  MCP Cedar Proxy │────▶│  MCP Server A   │
│  Agent      │     │                  │     │  (filesystem)   │
│             │     │  ┌────────────┐  │     ├─────────────────┤
│             │     │  │   Cedar    │  │────▶│  MCP Server B   │
│             │     │  │   Engine   │  │     │  (GitHub)       │
│             │     │  └────────────┘  │     ├─────────────────┤
│             │     │  ┌────────────┐  │────▶│  MCP Server C   │
│             │     │  │  Local GUI │  │     │  (database)     │
│             │     │  └────────────┘  │     └─────────────────┘
└─────────────┘     └──────────────────┘
                           ▲
                     ┌─────┴─────┐
                     │  Human    │
                     │  (browser)│
                     └───────────┘
```

## Quick Start

```bash
# Install the plugin
openclaw plugins install @openclaw/mcp-cedar-proxy

# Configure upstream MCP servers
openclaw configure

# Open the control GUI
open http://localhost:19820
```

## Configuration

```json5
{
  plugins: {
    entries: {
      "mcp-cedar-proxy": {
        enabled: true,
        config: {
          // Port for the local control GUI
          guiPort: 19820,

          // Upstream MCP servers to aggregate
          servers: {
            "filesystem": {
              transport: "stdio",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/documents"]
            },
            "github": {
              transport: "stdio",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-github"],
              env: { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
            },
            "brave-search": {
              transport: "http",
              url: "http://localhost:3001/mcp"
            }
          },

          // Cedar policy directory (auto-created with defaults)
          policyDir: "~/.openclaw/mcp-policies/",

          // Enable formal verification on policy changes
          verify: true
        }
      }
    }
  }
}
```

## Cedar Policies

The plugin generates a Cedar schema from discovered MCP tools and manages policies that control access:

```cedar
// Auto-generated: allow agent to use GitHub tools
permit(
  principal == Agent::"openclaw",
  action == Action::"call_tool",
  resource == Tool::"github/create_issue"
);

// Human-toggled: disable filesystem write tools
forbid(
  principal,
  action == Action::"call_tool",
  resource == Tool::"filesystem/write_file"
);
```

The GUI writes these policies when you toggle tools on/off. You can also edit them directly for fine-grained control (conditions on arguments, time-based access, etc.).

## Control GUI

The local web GUI shows:

- **Server status** — connected/disconnected, tool count, last heartbeat
- **Tool inventory** — every tool across all servers, with descriptions
- **Toggle switches** — enable/disable individual tools or entire servers
- **Policy view** — see the Cedar policies governing access (read-only or edit mode)
- **Verification status** — green check when policies are formally verified, warning when unverified
- **Audit log** — recent tool invocations with allow/deny decisions

## How It Works

1. On startup, the proxy connects to all configured MCP servers and discovers their capabilities
2. It generates a Cedar schema mapping servers → tools → arguments
3. Default policies are created (deny-all or allow-all, configurable)
4. The OpenClaw agent sees aggregated tools via the plugin's registered agent tools
5. When the agent calls a tool, the proxy evaluates the Cedar policy before forwarding
6. The GUI streams server status and tool inventory via WebSocket
7. Toggling a tool in the GUI writes/removes a Cedar policy and optionally re-verifies

## Development

```bash
git clone https://github.com/openclaw/mcp-cedar-proxy
cd mcp-cedar-proxy
npm install
npm run dev        # watch mode
npm test           # run tests
```

## License

Apache-2.0
