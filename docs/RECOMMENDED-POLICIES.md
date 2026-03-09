# Recommended Policies

Real-world Cedar policies for common "oh no" scenarios. These are starting points — adapt them to your agent's actual needs.

## The Basics

Carapace defaults to **allow-all** so installing it never breaks anything. The recommended path:

1. **Install** → everything works, you can see what your agent does
2. **Add forbids** → block the scary stuff (this doc)
3. **Switch to deny-all** → explicitly permit only what's needed (advanced)

Most people should start with step 2 and stay there until they're comfortable.

---

## Shell Policies

### Block destructive file operations

The classics. An agent with shell access can `rm -rf /` before you blink.

```cedar
// Block rm entirely — use trash instead
forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"rm"
);

// Block destructive disk tools
forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"rmdir"
);

forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"mkfs"
);

forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"dd"
);

// Block format/partition tools
forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"diskutil"
);
```

**Why:** An agent that can delete files can delete *all* files. `rm` is the single most dangerous command you can give an agent. Use `trash` (recoverable) instead and permit that.

### Block credential and secret access

Agents don't need to read your SSH keys or browser passwords.

```cedar
// Block direct credential access tools
forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"security"
);

forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"ssh-keygen"
);

forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"gpg"
);

// Block password managers
forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"op"
);

forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"pass"
);
```

**Why:** `security` (macOS Keychain CLI) can dump stored passwords. `ssh-keygen` can overwrite your keys. An agent doesn't need either of these to do useful work.

### Block system administration

Unless your agent is explicitly managing infrastructure, it shouldn't touch system config.

```cedar
forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"sudo"
);

forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"su"
);

forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"chmod"
);

forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"chown"
);

forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"launchctl"
);

forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"systemctl"
);
```

**Why:** Privilege escalation is the nightmare scenario. If your agent can `sudo`, it can do *anything*. Even `chmod` can weaken file permissions enough to enable other attacks.

### Block network reconnaissance

Agents don't need to scan your network.

```cedar
forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"nmap"
);

forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"tcpdump"
);

forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"netcat"
);

forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"nc"
);
```

### Allow a safe set of dev tools

If your agent does development work, permit the tools it actually needs:

```cedar
// Version control
permit(
  principal is Jans::Workload,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"git"
);

// Package managers
permit(
  principal is Jans::Workload,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"npm"
);

permit(
  principal is Jans::Workload,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"npx"
);

// Safe file operations
permit(
  principal is Jans::Workload,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"cat"
);

permit(
  principal is Jans::Workload,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"ls"
);

permit(
  principal is Jans::Workload,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"grep"
);

permit(
  principal is Jans::Workload,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"find"
);

permit(
  principal is Jans::Workload,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"trash"
);
```

---

## API Policies

### Block data exfiltration

An agent that can POST to any URL can send your files, credentials, and chat history anywhere.

```cedar
// Block known paste/upload services
forbid(
  principal,
  action == Jans::Action::"call_api",
  resource == Jans::API::"pastebin.com"
);

forbid(
  principal,
  action == Jans::Action::"call_api",
  resource == Jans::API::"hastebin.com"
);

forbid(
  principal,
  action == Jans::Action::"call_api",
  resource == Jans::API::"transfer.sh"
);

forbid(
  principal,
  action == Jans::Action::"call_api",
  resource == Jans::API::"file.io"
);

forbid(
  principal,
  action == Jans::Action::"call_api",
  resource == Jans::API::"webhook.site"
);

forbid(
  principal,
  action == Jans::Action::"call_api",
  resource == Jans::API::"requestbin.com"
);
```

**Why:** Prompt injection attacks can instruct an agent to exfiltrate data by posting it to an attacker-controlled URL. Blocking common exfil endpoints is a basic hygiene measure.

### Allow specific APIs your agent needs

Better than blocking bad domains: only allow the domains your agent actually uses.

```cedar
// GitHub API
permit(
  principal is Jans::Workload,
  action == Jans::Action::"call_api",
  resource == Jans::API::"api.github.com"
);

// npm registry
permit(
  principal is Jans::Workload,
  action == Jans::Action::"call_api",
  resource == Jans::API::"registry.npmjs.org"
);

// Your own services
permit(
  principal is Jans::Workload,
  action == Jans::Action::"call_api",
  resource == Jans::API::"api.yourcompany.com"
);
```

### Block social media posting

If your agent has social media access, you might want to prevent it from posting without oversight, or block it from leaking info to random accounts.

```cedar
// Block direct API access to social platforms
forbid(
  principal,
  action == Jans::Action::"call_api",
  resource == Jans::API::"api.twitter.com"
);

forbid(
  principal,
  action == Jans::Action::"call_api",
  resource == Jans::API::"api.x.com"
);

forbid(
  principal,
  action == Jans::Action::"call_api",
  resource == Jans::API::"graph.facebook.com"
);

forbid(
  principal,
  action == Jans::Action::"call_api",
  resource == Jans::API::"api.linkedin.com"
);
```

**Why:** An agent that can post to social media can damage your reputation in seconds. Even if your agent "should" post, you probably want that gated through an MCP tool with its own policy rather than raw API access.

---

## MCP Tool Policies

### Block destructive MCP tools

If you're using the filesystem MCP server, the write tools are the dangerous ones:

```cedar
forbid(
  principal,
  action == Jans::Action::"call_tool",
  resource == Jans::Tool::"filesystem/write_file"
);

forbid(
  principal,
  action == Jans::Action::"call_tool",
  resource == Jans::Tool::"filesystem/move_file"
);
```

### Block email mass operations

If your agent has email access via MCP:

```cedar
// Prevent bulk deletion
forbid(
  principal,
  action == Jans::Action::"call_tool",
  resource == Jans::Tool::"email/delete_all"
);

forbid(
  principal,
  action == Jans::Action::"call_tool",
  resource == Jans::Tool::"email/empty_trash"
);

// Prevent mass sending (spam)
forbid(
  principal,
  action == Jans::Action::"call_tool",
  resource == Jans::Tool::"email/send_bulk"
);
```

**Why:** An agent that can delete emails can delete your *entire inbox*. An agent that can send emails can spam your contacts. These are catastrophic, irreversible actions.

### Block database mutations

If your agent has database access:

```cedar
forbid(
  principal,
  action == Jans::Action::"call_tool",
  resource == Jans::Tool::"database/execute_sql"
);

// Allow reads only
permit(
  principal is Jans::Workload,
  action == Jans::Action::"call_tool",
  resource == Jans::Tool::"database/query"
);
```

---

## Complete Starter Policies

### "Cautious developer" — safe for a coding agent

```cedar
// Shell: allow common dev tools, block everything dangerous
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"git");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"npm");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"npx");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"node");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"cat");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"ls");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"grep");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"find");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"trash");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"mkdir");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"cp");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"mv");

forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"rm");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"sudo");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"security");

// API: allow GitHub and npm, block exfil
permit(principal is Jans::Workload, action == Jans::Action::"call_api", resource == Jans::API::"api.github.com");
permit(principal is Jans::Workload, action == Jans::Action::"call_api", resource == Jans::API::"registry.npmjs.org");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"pastebin.com");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"webhook.site");

// MCP: allow all tools (rely on shell/API policies for safety)
permit(principal is Jans::Workload, action == Jans::Action::"call_tool", resource);
```

### "Paranoid lockdown" — least privilege, deny-all baseline

Set `defaultPolicy: "deny-all"` in config, then only add permits:

```cedar
// Only the exact tools this agent needs
permit(principal is Jans::Workload, action == Jans::Action::"call_tool", resource == Jans::Tool::"filesystem/read_file");
permit(principal is Jans::Workload, action == Jans::Action::"call_tool", resource == Jans::Tool::"filesystem/list_directory");

// Only git
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"git");

// No API access at all (omit all call_api permits)
```

Everything not explicitly permitted is denied. This is the most secure posture but requires you to know exactly what your agent needs.

---

## Policy Design Principles

1. **Forbid the catastrophic, then iterate.** Start by blocking `rm`, `sudo`, and data exfil domains. You can always add more forbids later.

2. **Forbid always wins.** In Cedar, a `forbid` policy overrides any `permit`. This means you can write broad permits and surgical forbids without worrying about order or precedence.

3. **Binary name is the gate, not the arguments.** `Shell::"git"` permits *all* git commands including `git push --force`. If you need argument-level control, use Cedar `when` conditions on `context.args`:

   ```cedar
   forbid(
     principal,
     action == Jans::Action::"exec_command",
     resource == Jans::Shell::"git"
   ) when {
     context.args like "*--force*"
   };
   ```

4. **Domain name is the gate, not the path.** `API::"api.github.com"` permits all endpoints on that domain. If you need path-level control, use `when` conditions on `context.url`.

5. **Deny-all is aspirational.** Most people should start with allow-all + surgical forbids. Switch to deny-all only when you understand your agent's full tool surface.

6. **Review regularly.** Your agent's needs change. Policies that made sense last month might be too loose or too tight today. The GUI makes this easy — open it, look at what's enabled, adjust.

---

## Further Reading

- [Cedar for AI Agents: Why Your AI Agent Needs a Policy Language](https://clawdrey.com/blog/cedar-for-ai-agents-part-1-why-your-ai-agent-needs-a-policy-language.html)
- [Cedar for AI Agents: Writing Your First Agent Policy](https://clawdrey.com/blog/cedar-for-ai-agents-part-2-writing-your-first-agent-policy.html)
- [Cedar for AI Agents: When Forbid Meets Permit](https://clawdrey.com/blog/cedar-for-ai-agents-part-3-when-forbid-meets-permit.html)
- [Cedar for AI Agents: Proving It — SMT Solvers and Why I Trust Math More Than Tests](https://clawdrey.com/blog/proving-it-smt-solvers-and-why-i-trust-math-more-than-tests.html)
- [Cedar Language Reference](https://docs.cedarpolicy.com/)
- [Carapace README](../README.md)
