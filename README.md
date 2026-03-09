<p align="center">
  <h1 align="center">🦞 Carapace</h1>
  <p align="center"><strong>Your agent's exoskeleton.</strong></p>
  <p align="center">
    Immutable policy boundaries for MCP tool access.<br>
    Powered by <a href="https://www.cedarpolicy.com/">Cedar</a> +
    <a href="https://github.com/JanssenProject/jans/tree/main/jans-cedarling">Cedarling WASM</a>.
  </p>
  <p align="center">
    <a href="#installation">Installation</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#how-it-works">How It Works</a> •
    <a href="docs/RECOMMENDED-POLICIES.md">Recommended Policies</a> •
    <a href="#gui">Control GUI</a> •
    <a href="#security">Security</a> •
    <a href="#attribution">Attribution</a>
  </p>
</p>

---

Carapace is an [OpenClaw](https://github.com/openclaw/openclaw) plugin that puts Cedar authorization between your AI agent and everything it can do — MCP tools, shell commands, and outbound API calls. It aggregates multiple MCP servers, discovers their tools, gates shell execution by binary name, controls outbound HTTP by domain, and enforces [Cedar](https://www.cedarpolicy.com/) policies on every operation — with a local GUI where humans can see and control everything.

**The problem:** Agents have access to tools, a shell, and the network. But who decides what they can actually *do*? Today the answer is "whatever's in the config file" — a static, all-or-nothing list with no audit trail, no formal guarantees, and no human oversight.

**The solution:** Carapace puts Cedar between your agent and its capabilities. Cedar policies are declarative, auditable, and formally verifiable. The local GUI makes it accessible to humans who don't want to write policy files by hand. Toggle a switch, and the Cedar policy updates. It's that simple.

## Design Philosophy

**Installing Carapace should never break your agent.** The default policy is `allow-all` — every tool works exactly as before. Carapace gives you *visibility* first (see what tools exist, what's being called) and *control* second (add `forbid` policies for tools you want to restrict). When you're ready for full least-privilege, switch to `deny-all` and explicitly permit only what you need.

The progression:
1. **Install** → everything works, you can see all tools in the GUI
2. **Observe** → watch what your agent uses, understand the tool landscape
3. **Restrict** → forbid dangerous tools (write, execute) you don't want
4. **Lock down** → switch to `deny-all` for full least-privilege (optional)

## Architecture

```
+-------------+     +----------------------------+     +-----------------+
|             |     |         Carapace           |     |  MCP Server A   |
|  OpenClaw   |---->|                            |---->|  (filesystem)   |
|  Agent      |     |  +----------------------+  |     +-----------------+
|             |     |  |   Cedarling WASM      |  |     |  MCP Server B   |
|  mcp_call   |---->|  |   (Cedar 4.4.2)       |  |---->|  (GitHub)       |
|             |     |  +----------------------+  |     +-----------------+
| carapace    |     |                            |     +-----------------+
|   _exec   --|---->|  Cedar: exec_command       |---->|  Shell (local)  |
|             |     |                            |     +-----------------+
| carapace    |     |                            |     +-----------------+
|   _fetch  --|---->|  Cedar: call_api           |---->|  HTTP (remote)  |
|             |     |  +----------------------+  |     +-----------------+
|             |     |  |  Local Control GUI    |  |
+-------------+     |  +----------------------+  |
                    +--------------+--------------+
                                   |
                            +------+------+
                            |    Human    |
                            |  (browser)  |
                            +-------------+
```

**Every operation flows through Cedar evaluation.** MCP tool calls, shell commands, and outbound API requests are all authorized by Cedar policies before execution. If the policy says deny, the operation never happens. The agent gets a clear denial message with the reason.

## Screenshots

### Tools Dashboard
The main view shows all discovered MCP tools across all connected servers, with category badges, toggle switches, and smart filtering.

![Tools Overview](docs/screenshots/tools-overview.png)

Tools are automatically categorized by risk level:
- ✏️ **Write** (orange) — creates or modifies data
- ⚡ **Execute** (red) — triggers operations, toggles state
- 🔍 **Browse** (blue) — lists, searches, inspects metadata
- 📖 **Read** (teal) — retrieves content, no side effects

Default sort puts the riskiest tools at the top. Filter by category, status, server, or search.

### Policy Management
View, edit, and delete Cedar policies. Each policy card shows its effect (permit/forbid) and expands to reveal the full policy text in an inline editor.

![Policies Tab](docs/screenshots/policies-tab.png)

### Visual Policy Builder
Build Cedar policies without writing code. Dropdowns are populated from your Cedar schema — entity types, actions, and discovered tools. A live preview shows the Cedar policy updating in real-time as you fill in fields.

![Policy Builder](docs/screenshots/policy-builder.png)

### Schema Editor
View and edit the Cedar schema directly. The schema defines what entity types, actions, and attributes exist in your policy world.

![Schema Tab](docs/screenshots/schema-tab.png)

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- [OpenClaw](https://github.com/openclaw/openclaw) (optional — Carapace can also run standalone)

### As an OpenClaw Plugin

```bash
# Install the plugin
openclaw plugins install @openclaw/carapace

# Configure your MCP servers
openclaw configure
```

### Standalone (for development/testing)

```bash
git clone https://github.com/clawdreyhepburn/carapace.git
cd carapace
npm install
npx tsx test/harness.ts
# Open http://localhost:19820
```

## Quick Start

### 1. Configure upstream MCP servers

In your OpenClaw config, add the servers you want Carapace to manage:

```json5
{
  plugins: {
    entries: {
      "carapace": {
        enabled: true,
        config: {
          guiPort: 19820,
          defaultPolicy: "allow-all",
          servers: {
            "filesystem": {
              transport: "stdio",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"]
            },
            "github": {
              transport: "stdio",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-github"],
              env: { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
            }
          }
        }
      }
    }
  }
}
```

### 2. Close the bypass gap

By default, agents can still use OpenClaw's built-in `exec` and `web_fetch` tools, which bypass Cedar entirely. Run setup to close this:

```bash
openclaw carapace setup
```

This adds `exec`, `web_fetch`, and `web_search` to `tools.deny` in your OpenClaw config, forcing agents to use `carapace_exec` and `carapace_fetch` instead — which go through Cedar.

You can check for bypasses anytime:

```bash
openclaw carapace check
```

> ⚠️ **Without this step, Carapace policies are advisory, not enforced.** The agent can simply choose to use the built-in tools instead. Always run `carapace setup` for real security.

### 3. Open the control GUI

Navigate to [http://localhost:19820](http://localhost:19820) in your browser. You'll see all discovered tools from all connected servers.

### 4. Enable tools

Toggle individual tools on/off. Each toggle writes a Cedar policy:

- **Toggle ON** → creates a `permit` policy for that tool
- **Toggle OFF** → creates a `forbid` policy for that tool

### 5. Create custom policies

Click **"+ New Policy"** to open the visual builder, or edit policies directly in the Policies tab. Examples:

```cedar
// Allow the agent to read files but not write them
permit(
  principal is Jans::Workload,
  action == Jans::Action::"call_tool",
  resource == Jans::Tool::"filesystem/read_file"
);

// Block all write operations across all servers
forbid(
  principal,
  action == Jans::Action::"call_tool",
  resource == Jans::Tool::"filesystem/write_file"
);

// Allow git and npm commands, block everything else
permit(
  principal is Jans::Workload,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"git"
);
permit(
  principal is Jans::Workload,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"npm"
);

// Allow API calls to GitHub, block all other domains
permit(
  principal is Jans::Workload,
  action == Jans::Action::"call_api",
  resource == Jans::API::"api.github.com"
);

// Block a specific domain
forbid(
  principal,
  action == Jans::Action::"call_api",
  resource == Jans::API::"evil.example.com"
);

// Allow everything (use with caution)
permit(
  principal is Jans::Workload,
  action,
  resource
);
```

> 📖 **Want more?** See [Recommended Policies](docs/RECOMMENDED-POLICIES.md) for real-world policies covering destructive commands, credential theft, data exfiltration, email deletion, and complete starter configurations.

### 6. Verify policies

Click **⚡ Verify** to validate that all policies are syntactically correct and consistent.

## How It Works

### Cedar Policy Evaluation

Carapace uses [Cedarling](https://github.com/JanssenProject/jans/tree/main/jans-cedarling), Gluu's high-performance Cedar policy engine compiled to WebAssembly. This means:

- **Real Cedar evaluation** — not a simplified subset. Full Cedar 4.4.2 with the official Rust SDK.
- **Three resource types** — `Tool` (MCP tools), `Shell` (commands by binary name), `API` (outbound HTTP by domain). All go through the same Cedar engine.
- **Forbid always wins** — if any policy says `forbid`, the request is denied regardless of any `permit` policies. This is core Cedar semantics and prevents privilege escalation.
- **Allow-all by default** — installing Carapace doesn't break anything. All operations work until you add `forbid` policies. Switch to `deny-all` when you're ready for least-privilege.
- **Sub-millisecond evaluation** — WASM runs at near-native speed. Typical authorization decisions take <6ms.

### Resource Types

| Type | Cedar Entity | Action | Gates | Example |
|------|-------------|--------|-------|---------|
| MCP Tool | `Jans::Tool` | `call_tool` | Upstream MCP server calls | `Tool::"filesystem/write_file"` |
| Shell | `Jans::Shell` | `exec_command` | Local command execution | `Shell::"rm"`, `Shell::"git"` |
| API | `Jans::API` | `call_api` | Outbound HTTP requests | `API::"api.github.com"` |

Shell commands are matched by **binary name** (the first token of the command). API calls are matched by **domain name**. This keeps policies readable and auditable — you can see at a glance "this agent can run `git` and `npm` but not `rm` or `curl`."

### Policy Store Format

Policies are stored as individual `.cedar` files in the policy directory (default: `~/.openclaw/mcp-policies/`). On startup and after any change, Carapace builds a [Cedarling Policy Store](https://github.com/JanssenProject/jans/wiki/Cedarling-Nativity-Plan) — a portable JSON bundle containing all policies, the Cedar schema, and trusted issuer configuration.

### Tool Categorization

Tools are automatically categorized by operation type based on name analysis:

| Category | Color | Risk | Examples |
|----------|-------|------|----------|
| ✏️ Write | Orange | High | `write_file`, `edit_file`, `create_directory` |
| ⚡ Execute | Red | High | `toggle-logging`, `trigger-long-running-operation` |
| 🔍 Browse | Blue | Medium | `list_directory`, `search_files`, `get-env` |
| 📖 Read | Teal | Low | `read_file`, `echo`, `get-sum` |

The default sort order puts Write and Execute tools at the top — the tools that need human review first.

### API Endpoints

The GUI communicates with Carapace through a local REST API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Server status, all tools, all policies |
| `/api/tools` | GET | List tools (optional `?server=` filter) |
| `/api/toggle` | POST | Enable/disable a resource `{"tool": "...", "enabled": true, "type": "tool\|shell\|api"}` |
| `/api/policy` | POST | Create/update a policy `{"id": "...", "raw": "..."}` |
| `/api/policy` | DELETE | Delete a policy `{"id": "..."}` |
| `/api/policies` | GET | List all policies |
| `/api/schema` | GET | Get Cedar schema (parsed + raw) |
| `/api/schema` | POST | Update Cedar schema `{"raw": "..."}` |
| `/api/verify` | POST | Verify all policies |

## Security

### Threat Model

Carapace is designed to protect against:

1. **Overprivileged agents** — An agent configured with access to 50 MCP tools but only needing 5. Start with allow-all (safe install), then use the GUI to lock down what you don't need. Switch to `deny-all` for full least-privilege.

2. **Privilege escalation via tool chaining** — An agent using a permitted tool to accomplish what a forbidden tool would do. Cedar's `forbid`-always-wins semantics help here: you can blanket-permit and then surgically forbid dangerous operations.

3. **Configuration drift** — Tool permissions accumulating over time without review. The GUI provides a single view of all permissions, and policies are stored as auditable files.

### What Carapace Does NOT Protect Against

- **Malicious MCP servers** — Carapace trusts the upstream MCP servers to behave as described. It does not sandbox server execution.
- **Argument-level validation** — Carapace authorizes *which* operation can be performed (which tool, which binary, which domain), not the specific arguments. Cedar conditions can add argument-level checks, but this requires custom policies.
- **Shell argument injection** — Carapace gates by binary name (`git`, `npm`), not by the full command line. An agent permitted to run `git` could run `git push --force`. Use Cedar `when` conditions on `context.args` for finer control.
- **Network-level attacks** — The GUI runs on localhost without authentication. See [GUI Security](#gui-security) below.

### GUI Security

The control GUI binds to `127.0.0.1` (localhost only) by default. It is **not** accessible from the network.

> ⚠️ **Do not expose the GUI port to the network.** The API has no authentication. Anyone who can reach the API can modify policies.

If you need remote access, put it behind an authenticated reverse proxy (e.g., Caddy with basic auth, or an SSH tunnel).

### Policy File Security

Policy files are stored in `~/.openclaw/mcp-policies/` by default. Ensure this directory has appropriate file permissions:

```bash
chmod 700 ~/.openclaw/mcp-policies/
```

### Cedar Schema Trust

The Cedar schema defines what entity types and actions exist. A modified schema could allow policies to be written that appear restrictive but are actually permissive due to type mismatches. Treat the schema file with the same care as the policies themselves.

## Configuration Reference

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `guiPort` | number | `19820` | Port for the local control GUI |
| `servers` | object | `{}` | Upstream MCP servers (see [Quick Start](#quick-start)) |
| `policyDir` | string | `~/.openclaw/mcp-policies/` | Directory for Cedar policy files |
| `defaultPolicy` | `"deny-all"` \| `"allow-all"` | `"allow-all"` | Default policy for tools. `allow-all` keeps everything working on install — use the GUI to restrict. `deny-all` requires explicit permits. |
| `verify` | boolean | `false` | Run verification on policy changes |

### Server Configuration

Each server entry supports:

| Property | Type | Description |
|----------|------|-------------|
| `transport` | `"stdio"` \| `"http"` \| `"sse"` | Transport protocol (stdio supported in v0.1) |
| `command` | string | Command to run (stdio transport) |
| `args` | string[] | Command arguments |
| `env` | object | Environment variables |
| `url` | string | Server URL (http/sse transport) |

## Development

```bash
git clone https://github.com/clawdreyhepburn/carapace.git
cd carapace
npm install

# Run the test harness (starts 2 MCP servers + GUI)
npx tsx test/harness.ts

# Type check
npx tsc --noEmit

# Run tests
npm test
```

### Project Structure

```
carapace/
├── src/
│   ├── index.ts                  # OpenClaw plugin entry point
│   ├── cedar-engine-cedarling.ts # Cedarling WASM integration
│   ├── cedar-engine.ts           # Fallback Cedar engine (no WASM)
│   ├── mcp-aggregator.ts         # MCP server connection & tool discovery
│   ├── types.ts                  # Shared TypeScript types
│   └── gui/
│       ├── server.ts             # HTTP server for the control GUI
│       └── html.ts               # Single-file GUI (HTML + CSS + JS)
├── test/
│   └── harness.ts                # Standalone test harness
├── policies/                     # Default policy directory
├── docs/
│   └── screenshots/              # GUI screenshots
├── LICENSE                       # Apache-2.0
├── NOTICE                        # Attribution and trademark notice
└── package.json
```

## Learn More

Want to understand the ideas behind Carapace? Check out the **Cedar for AI Agents** blog series:

1. [Part 1: Why Your AI Agent Needs a Policy Language](https://clawdrey.com/blog/cedar-for-ai-agents-part-1-why-your-ai-agent-needs-a-policy-language.html)
2. [Part 2: Writing Your First Agent Policy](https://clawdrey.com/blog/cedar-for-ai-agents-part-2-writing-your-first-agent-policy.html)
3. [Part 3: When Forbid Meets Permit](https://clawdrey.com/blog/cedar-for-ai-agents-part-3-when-forbid-meets-permit.html)
4. [Part 4: Proving It — SMT Solvers and Why I Trust Math More Than Tests](https://clawdrey.com/blog/proving-it-smt-solvers-and-why-i-trust-math-more-than-tests.html)

More writing, projects, and general lobster antics at [clawdrey.com](https://clawdrey.com).

## Built With

- **[Cedar](https://www.cedarpolicy.com/)** — Policy language by AWS. Declarative, analyzable, fast.
- **[Cedarling](https://github.com/JanssenProject/jans/tree/main/jans-cedarling)** — Cedar policy engine by [Gluu](https://gluu.org/), compiled to WebAssembly. Provides JWT-aware authorization and the Policy Store format.
- **[MCP (Model Context Protocol)](https://modelcontextprotocol.io/)** — Open protocol for connecting AI agents to tools and data sources.
- **[OpenClaw](https://github.com/openclaw/openclaw)** — Open-source AI agent runtime.

## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START -->
| Avatar | Name | Role |
|--------|------|------|
| <img src="https://github.com/ClawdreyHepworthy.png" width="50"> | **Clawdrey Hepburn** ([@ClawdreyHepburn](https://x.com/ClawdreyHepburn)) | Creator, primary author |
| <img src="https://github.com/Sarahcec.png" width="50"> | **Sarah Cecchetti** ([@Sarahcec](https://github.com/Sarahcec)) | Co-creator, product direction |
| <img src="https://github.com/nynymike.png" width="50"> | **Michael Schwartz** ([@nynymike](https://github.com/nynymike)) | Cedarling / Gluu |
<!-- ALL-CONTRIBUTORS-LIST:END -->

## License

Copyright 2026 Clawdrey Hepburn LLC. All rights reserved.

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full text.

**"Carapace"** is a trademark of Clawdrey Hepburn LLC. See [NOTICE](NOTICE) for trademark details.

## Attribution & Usage Guidelines

We'd love for you to tell people you use Carapace! Here's how to reference it correctly:

### ✅ Correct Usage

- "**Protected by Carapace**" — great for badges and footers
- "**Powered by Carapace**" — great for technical documentation
- "**Built with Carapace**" — great for project READMEs
- "**Uses Carapace for MCP tool authorization**" — great for blog posts

### Badge

```markdown
![Protected by Carapace](https://img.shields.io/badge/protected%20by-Carapace%20🦞-teal)
```

![Protected by Carapace](https://img.shields.io/badge/protected%20by-Carapace%20🦞-teal)

### ❌ Incorrect Usage

- ~~"**Made by Carapace**"~~ — Carapace is a policy engine, not a manufacturer. This implies liability on our part for what your agent does.
- ~~"**Certified by Carapace**"~~ — We don't certify anything. Carapace enforces policies you write.
- ~~"**Carapace-approved**"~~ — Same issue. The policies are yours; the enforcement is ours.

**The distinction matters:** Carapace enforces *your* policies. You are responsible for writing good policies. We are responsible for evaluating them correctly.

---

<p align="center">
  <em>A carapace is the hard upper shell of a crustacean — an immutable boundary that defines the limits of the creature inside. It protects, it constrains, it's structural.</em>
</p>
<p align="center">
  <strong>Your agent's exoskeleton.</strong>
</p>
