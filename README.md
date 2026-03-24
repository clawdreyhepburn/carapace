<p align="center">
  <h1 align="center">🦞 Carapace</h1>
  <p align="center"><strong>Your agent's exoskeleton.</strong></p>
  <p align="center">
    The deployment-level policy ceiling for AI agents. Controls which tools, commands, and APIs your agent can access. Simple allow/deny Cedar evaluation — if a policy says no, it's no. For per-agent mandate evaluation, see <a href="https://github.com/clawdreyhepburn/ovid-me">@clawdreyhepburn/ovid-me</a>.
  </p>
  <p align="center">
    <a href="#how-it-works">How It Works</a> •
    <a href="#installation">Installation</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#policy-source">Policy Source</a> •
    <a href="docs/SECURITY.md">Security Guide</a> •
    <a href="docs/RECOMMENDED-POLICIES.md">Recommended Policies</a> •
    <a href="#the-control-gui">Control GUI</a> •
    <a href="#attribution">Attribution</a>
  </p>
</p>

---

## What is Carapace?

AI agents can do a lot. They can read and write files, run shell commands, call APIs, send emails, push code — anything you give them access to. That's powerful, but it's also dangerous. An agent that can delete files can delete *all* files. An agent that can call APIs can send your data anywhere.

**Carapace is a security layer that controls what your agent is allowed to do.** You write rules (called policies) that say things like "this agent can read files but not delete them" or "this agent can use git but not run sudo." Carapace enforces those rules on every single action the agent takes.

It works as a plugin for [OpenClaw](https://github.com/openclaw/openclaw) (an open-source AI agent platform), but the concepts apply to any agent system.

### What does it control?

Carapace gates three types of operations:

| What | How it works | Example |
|------|-------------|---------|
| **MCP tools** | Your agent connects to external tool servers (file system, GitHub, databases) via [MCP](https://modelcontextprotocol.io/). Carapace checks each tool call against your policies before it executes. | Allow `read_file`, block `write_file` |
| **Shell commands** | Your agent runs commands on your computer. Carapace checks which program the agent is trying to run. | Allow `git` and `ls`, block `rm` and `sudo` |
| **API calls** | Your agent makes HTTP requests to websites and services. Carapace checks which domain the agent is trying to reach. | Allow `api.github.com`, block `pastebin.com` |

### What is Cedar?

[Cedar](https://www.cedarpolicy.com/) is a policy language created by AWS. Instead of configuring permissions in a settings file or a database, you write human-readable rules like this:

```cedar
// Let the agent use git
permit(
  principal is Jans::Workload,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"git"
);

// Never let the agent delete files
forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"rm"
);
```

Cedar has one critical property: **forbid always wins.** If any rule says "no," the action is blocked — no matter how many other rules say "yes." This means you can't accidentally create a loophole by adding a new "allow" rule that overrides your safety restrictions.

Carapace uses [Cedarling](https://github.com/JanssenProject/jans/tree/main/jans-cedarling), a high-performance Cedar engine compiled to WebAssembly, so policy checks run in under 6 milliseconds.

### What is OpenClaw?

[OpenClaw](https://github.com/openclaw/openclaw) is an open-source platform for running AI agents. It connects AI models (like Claude or GPT) to messaging apps, tools, and services. Think of it as the runtime that makes your agent work. Carapace plugs into OpenClaw to add authorization — controlling what the agent is allowed to do within that runtime.

### What is MCP?

[MCP (Model Context Protocol)](https://modelcontextprotocol.io/) is an open standard for connecting AI agents to tools. An MCP server provides tools (like "read a file" or "search a database"), and the agent calls those tools to get work done. Carapace evaluates Cedar policies before each tool call executes, blocking anything your policies don't allow.

---

## How It Works

Carapace registers a `before_tool_call` hook in OpenClaw's plugin system. Every time the agent tries to use a tool — any tool — OpenClaw calls Carapace first. Carapace evaluates the call against your Cedar policies and either allows it or blocks it.

```
Agent decides to call a tool
        ↓
OpenClaw fires before_tool_call hook
        ↓
Carapace receives { toolName, params }
        ↓
Cedar evaluates the call against your policies
        ↓
 ALLOW → tool executes normally
 DENY  → tool call is blocked, agent gets an error
```

This is simple and un-bypassable — every tool call in OpenClaw goes through the hook system. There's no way for the agent to skip it because the enforcement happens inside the runtime, before the tool code runs.

### What gets checked

When Carapace receives a tool call, it maps it to one of three resource types:

- **`exec` / `process`** → **Shell**: extracts the binary name from the command (e.g., `git`, `rm`, `curl`)
- **`web_fetch` / `web_search`** → **API**: extracts the hostname from the URL (e.g., `api.github.com`, `pastebin.com`)
- **Everything else** (MCP tools, browser actions, etc.) → **Tool**: uses the tool name directly (e.g., `mcp_call/github/create_issue`, `browser`)

### The Control GUI

Carapace includes a web dashboard (runs locally on your machine) where you can:

- **See all tools** your agent has access to, organized by risk level
- **Toggle tools on/off** with a switch — each toggle creates a Cedar policy
- **Build policies visually** using dropdown menus instead of writing Cedar by hand
- **Edit the Cedar schema** that defines your policy structure
- **Verify** that all your policies are valid

Open it at [http://localhost:19820](http://localhost:19820) after starting Carapace.

---

## Architecture

```
+-------------+        +----------------------------+        +-----------------+
|             |        |         Carapace           |        |  MCP Server A   |
|  OpenClaw   |------->|  before_tool_call hook     |------->|  (filesystem)   |
|  Agent      |        |         |                  |        +-----------------+
|             |        |   Cedar evaluates          |        |  MCP Server B   |
|             |        |   every tool call          |------->|  (GitHub)       |
|             |        |         |                  |        +-----------------+
|             |        |  +----------------------+  |
|             |        |  |   Cedarling WASM      |  |
|             |        |  |   (Cedar 4.4.2)       |  |
|             |        |  +----------------------+  |
|             |        |  +----------------------+  |
|             |        |  |  Local Control GUI    |  |
+-------------+        |  +----------------------+  |
                       +--------------+--------------+
                                      |
                               +------+------+
                               |    Human    |
                               |  (browser)  |
                               +-------------+
```

**Key components:**

- **`before_tool_call` hook** — Registered in OpenClaw's plugin system. Every tool call passes through this hook before executing. Denied calls never reach the tool.
- **Cedarling WASM** — The Cedar policy engine, running as WebAssembly for near-native speed. This is where your policies are evaluated.
- **Control GUI** — A local web dashboard for managing tools and policies. Single HTML file, no build step, dark theme.

---

## Screenshots

### Tools Dashboard
See all tools across all connected servers. Toggle switches control access. Color-coded by risk level.

![Tools Overview](docs/screenshots/tools-overview.png)

### Policy Management
View, edit, and delete Cedar policies. Each card shows permit/forbid and the full policy text.

![Policies Tab](docs/screenshots/policies-tab.png)

### Visual Policy Builder
Build policies with dropdown menus instead of writing Cedar. Live preview updates as you go.

![Policy Builder](docs/screenshots/policy-builder.png)

### Schema Editor
View and edit the Cedar schema that defines your policy types and actions.

![Schema Tab](docs/screenshots/schema-tab.png)

---

## Installation

### What you need

- [Node.js](https://nodejs.org/) 20 or later
- [OpenClaw](https://github.com/openclaw/openclaw) installed and running

### Step 1: Install the plugin

```bash
openclaw plugins install @clawdreyhepburn/carapace
```

### Step 2: Enable Carapace

Run the setup command:

```bash
openclaw carapace setup
```

That's it. This enables the Carapace plugin in your OpenClaw config (`plugins.entries.carapace`). The plugin loads automatically via config watcher — no restart needed.

If you want to verify:

```bash
openclaw carapace status
```

### Step 3: Open the dashboard

Go to [http://localhost:19820](http://localhost:19820) to see your tools, manage policies, and control access.

### Uninstalling

```bash
openclaw carapace uninstall
```

This disables the Carapace plugin in your config. That's all — no other config changes to clean up.

To fully remove the plugin files:

```bash
openclaw plugins remove @clawdreyhepburn/carapace
```

### For development

```bash
git clone https://github.com/clawdreyhepburn/carapace.git
cd carapace
npm install
npx tsx test/harness.ts    # Starts test servers + GUI on port 19820
```

---

## Quick Start

Once you've installed and configured Carapace (see [Installation](#installation) above), here's how to start using it.

### Write your first policy

Here's a common starting point — let the agent use development tools but block dangerous commands:

```cedar
// Allow git, ls, cat, grep
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"git");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"ls");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"cat");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"grep");

// Block dangerous commands
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"rm");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"sudo");

// Allow GitHub API, block data exfiltration sites
permit(principal is Jans::Workload, action == Jans::Action::"call_api", resource == Jans::API::"api.github.com");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"pastebin.com");
```

> 🔒 **Want the full security walkthrough?** See the [Security Hardening Guide](docs/SECURITY.md) — step-by-step instructions with copy-paste commands for macOS, Linux, and Windows.
>
> 📖 **Want more policy examples?** See [Recommended Policies](docs/RECOMMENDED-POLICIES.md) — ready-made policies for common scenarios like blocking credential access, preventing data exfiltration, and complete starter configurations for different agent roles.

---

## Policy Source

Carapace is the **deployment-level policy ceiling** — it defines the maximum set of permissions any agent can have. For per-agent mandate evaluation (task-specific Cedar policy sets, delegation chains, subset proofs), see [`@clawdreyhepburn/ovid-me`](https://github.com/clawdreyhepburn/ovid-me).

### How OVID-ME queries Carapace

OVID-ME needs to know the deployment's effective Cedar policies to verify that a sub-agent's mandate is a subset of what the deployment allows. Carapace exposes this via the `PolicySource` interface:

```typescript
import { CarapacePolicySource } from '@clawdreyhepburn/carapace';

const policySource = new CarapacePolicySource('~/.openclaw/mcp-policies/');
const policies = await policySource.getEffectivePolicy('agent-id');
// Returns: concatenated Cedar policy text from all .cedar files
```

The GUI also exposes an HTTP endpoint:

```
GET http://localhost:19820/api/policy-source?principal=<id>
→ Returns Cedar policy text (text/plain)
```

Carapace policies are deployment-wide — the same policies apply to all principals. Principal-specific filtering happens in OVID-ME's mandate evaluation, not here.

---

## Design Philosophy

**Installing Carapace should never break your agent.** The default is `allow-all` — everything works exactly as before. You get visibility first (see what tools exist, what's being called) and control second (add restrictions when you're ready).

The recommended progression:

1. **Install** → everything works, open the GUI and look around
2. **Observe** → see what tools your agent actually uses
3. **Forbid the scary stuff** → block `rm`, `sudo`, exfiltration domains
4. **Lock down** → switch to `deny-all` and explicitly permit only what's needed

Most people should stay at step 3. Step 4 is for when you really understand your agent's tool surface.

---

## Security

### What Carapace protects against

- **Overprivileged agents** — Your agent has access to 50 tools but only needs 5. Carapace lets you restrict the other 45.
- **Prompt injection** — Someone tricks your agent into running dangerous commands. If the policy says `rm` is forbidden, it doesn't matter what the prompt says.
- **Data exfiltration** — Your agent tries to send sensitive data to an external service. If the domain isn't permitted, the request is blocked.
- **Privilege escalation** — An agent tries to use one permitted tool to accomplish what a forbidden tool would do. Cedar's forbid-always-wins makes this harder.
- **Sub-agent over-privilege** — Carapace defines the deployment ceiling. For per-agent mandate enforcement, see [`@clawdreyhepburn/ovid-me`](https://github.com/clawdreyhepburn/ovid-me).

### What Carapace does NOT protect against

- **Malicious MCP servers** — Carapace trusts the MCP servers themselves. If a server lies about what a tool does, Carapace can't detect that.
- **Argument-level abuse** — Carapace checks *which* command runs (e.g., `git`), not *how* it's used (e.g., `git push --force`). You can add argument-level checks with Cedar `when` conditions, but it's not automatic.
- **Permitted binary abuse** — If you permit `node`, the agent can run `node -e "require('child_process').execSync('rm -rf /')"`. Permitting a language runtime is effectively permitting everything. See [Dangerous Permits](docs/SECURITY.md#dangerous-permits).
- **Code that runs outside tool calls** — OpenClaw hooks and plugins run directly in the process, not through tool calls. Carapace can't gate those. See [Enforcement Coverage](docs/SECURITY.md#enforcement-coverage).

### GUI security

The dashboard runs on `localhost` only — it's not accessible from the network. There's no authentication on the API. **Do not expose port 19820 to the internet.** If you need remote access, use an SSH tunnel or an authenticated reverse proxy.

---

## Configuration Reference

### Plugin config

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `guiPort` | number | `19820` | Port for the control dashboard |
| `policyDir` | string | `~/.openclaw/mcp-policies/` | Where Cedar policy files are stored |
| `defaultPolicy` | `"allow-all"` or `"deny-all"` | `"allow-all"` | Starting posture. `allow-all` is safe to install — nothing breaks. `deny-all` requires explicit permits for every tool. |
| `verify` | boolean | `false` | Validate policies on every change |

### CLI commands

```bash
openclaw carapace setup     # Enable the Carapace plugin
openclaw carapace check     # Check for configuration issues
openclaw carapace status    # Show tool counts and policy status
openclaw carapace tools     # List all tools with enabled/disabled status
openclaw carapace verify    # Validate all policies
openclaw carapace uninstall # Disable the plugin
```

---

## Development

```bash
git clone https://github.com/clawdreyhepburn/carapace.git
cd carapace
npm install

# Run the test harness (GUI on port 19820)
npx tsx test/harness.ts

# Type check
npx tsc --noEmit

# Run the full test suite
npx tsx test/test-shell-gate.mjs      # Shell gating (9 tests)
npx tsx test/test-adversarial.mjs     # Adversarial bypass attempts (30+9 tests)
npx tsx test/test-block-myself.mjs    # End-to-end cp block demo
```

### Project structure

```
carapace/
├── src/
│   ├── index.ts                  # OpenClaw plugin entry — registers before_tool_call hook
│   ├── cedar-engine-cedarling.ts # Cedarling WASM engine — real Cedar 4.4.2 evaluation
│   ├── cedar-engine.ts           # Fallback engine (string matching, no WASM needed)
│   ├── policy-source.ts          # PolicySource for OVID-ME integration
│   ├── types.ts                  # Shared TypeScript types
│   └── gui/
│       ├── server.ts             # HTTP server for the dashboard
│       └── html.ts               # Dashboard UI (single HTML file, no build step)
├── test/
│   ├── harness.ts                # Standalone test environment
│   ├── test-shell-gate.mjs       # Shell command authorization tests
│   ├── test-adversarial.mjs      # Adversarial bypass test suite
│   └── test-block-myself.mjs     # End-to-end demo: block cp, try to copy, get denied
├── docs/
│   ├── SECURITY.md               # Security hardening (macOS/Linux/Windows)
│   ├── RECOMMENDED-POLICIES.md   # Policy examples for common use cases
│   └── screenshots/              # Dashboard screenshots
├── LICENSE                       # Apache-2.0
├── NOTICE                        # Trademark notice
└── openclaw.plugin.json          # OpenClaw plugin manifest
```

---

## Learn More

### Cedar for AI Agents — blog series

The ideas behind Carapace, explained step by step:

1. [Why Your AI Agent Needs a Policy Language](https://clawdrey.com/blog/cedar-for-ai-agents-part-1-why-your-ai-agent-needs-a-policy-language.html) — why config files aren't enough
2. [Writing Your First Agent Policy](https://clawdrey.com/blog/cedar-for-ai-agents-part-2-writing-your-first-agent-policy.html) — modeling agents, tools, and actions in Cedar
3. [When Forbid Meets Permit](https://clawdrey.com/blog/cedar-for-ai-agents-part-3-when-forbid-meets-permit.html) — why "forbid always wins" matters for safety
4. [Proving It: SMT Solvers and Why I Trust Math More Than Tests](https://clawdrey.com/blog/proving-it-smt-solvers-and-why-i-trust-math-more-than-tests.html) — formally verifying that policies are correct

More at [clawdrey.com](https://clawdrey.com).

### Built with

- **[Cedar](https://www.cedarpolicy.com/)** — Policy language by AWS. Human-readable rules with formal guarantees.
- **[Cedarling](https://github.com/JanssenProject/jans/tree/main/jans-cedarling)** — Cedar engine by [Gluu](https://gluu.org/), compiled to WebAssembly for speed.
- **[MCP](https://modelcontextprotocol.io/)** — Open protocol for connecting AI agents to tools.
- **[OpenClaw](https://github.com/openclaw/openclaw)** — Open-source AI agent platform.
- **[OVID](https://github.com/clawdreyhepburn/ovid)** — Cryptographic identity + Cedar mandates for sub-agents (JWTs with EdDSA/Ed25519).
- **[OVID-ME](https://github.com/clawdreyhepburn/ovid-me)** — Per-agent mandate evaluation (uses Carapace as its policy source).

---

## Contributors

| Avatar | Name | Role |
|--------|------|------|
| <img src="https://github.com/ClawdreyHepburn.png" width="50"> | **Clawdrey Hepburn** ([@ClawdreyHepburn](https://x.com/ClawdreyHepburn)) | Creator, primary author |
| <img src="https://github.com/Sarahcec.png" width="50"> | **Sarah Cecchetti** ([@Sarahcec](https://github.com/Sarahcec)) | Co-creator, product direction |
| <img src="https://github.com/nynymike.png" width="50"> | **Michael Schwartz** ([@nynymike](https://github.com/nynymike)) | Cedarling / Gluu |

---

## License

Copyright 2026 Clawdrey Hepburn LLC. Licensed under [Apache-2.0](LICENSE).

**"Carapace"** is a trademark of Clawdrey Hepburn LLC. See [NOTICE](NOTICE).

### Attribution

Using Carapace? Here's how to reference it:

- ✅ "**Protected by Carapace**" — for badges and footers
- ✅ "**Powered by Carapace**" — for technical docs
- ✅ "**Built with Carapace**" — for project READMEs
- ❌ ~~"Made by Carapace"~~ — implies we're liable for what your agent does
- ❌ ~~"Certified by Carapace"~~ — we don't certify anything

```markdown
![Protected by Carapace](https://img.shields.io/badge/protected%20by-Carapace%20🦞-teal)
```

![Protected by Carapace](https://img.shields.io/badge/protected%20by-Carapace%20🦞-teal)

**You write the policies. We enforce them.**

---

<p align="center">
  <em>A carapace is the hard upper shell of a crustacean — an immutable boundary that protects the creature inside.</em>
</p>
<p align="center">
  <strong>Your agent's exoskeleton.</strong>
</p>
