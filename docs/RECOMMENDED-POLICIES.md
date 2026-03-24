# Recommended Policies

Cedar policy examples for common use cases. Copy, adapt, deploy.

> **First:** Complete the [Security Hardening Guide](SECURITY.md) to ensure Carapace is properly enabled. Without that, these policies are advisory.

---

## Shell Policies

### Block destructive commands

```cedar
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"rm");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"rmdir");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"mkfs");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"dd");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"diskutil");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"format");
```

Use `trash` instead of `rm` — it's recoverable.

### Block privilege escalation

```cedar
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"sudo");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"su");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"chmod");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"chown");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"chgrp");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"launchctl");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"systemctl");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"sc");
```

### Block credential access

```cedar
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"security");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"ssh-keygen");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"gpg");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"op");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"pass");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"cmdkey");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"certutil");
```

### Block network recon

```cedar
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"nmap");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"tcpdump");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"netcat");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"nc");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"wireshark");
```

### Block shell wrappers

Prevent agents from using wrapper commands to run forbidden binaries:

```cedar
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"bash");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"sh");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"zsh");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"env");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"xargs");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"cmd");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"powershell");
```

### Allow safe dev tools

```cedar
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"git");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"npm");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"npx");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"cat");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"ls");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"grep");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"find");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"mkdir");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"trash");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"cp");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"mv");
```

### Restrict sensitive path reads

```cedar
forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"cat"
) when {
  context.args like "*/.ssh/*" ||
  context.args like "*/.aws/*" ||
  context.args like "*/.env*" ||
  context.args like "*/.gnupg/*"
};
```

### Block writes to OpenClaw directories

```cedar
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"cp")
  when { context.args like "*/.openclaw/*" };
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"mv")
  when { context.args like "*/.openclaw/*" };
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"tee")
  when { context.args like "*/.openclaw/*" };
```

---

## API Policies

### Block data exfiltration services

```cedar
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"pastebin.com");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"hastebin.com");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"transfer.sh");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"file.io");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"webhook.site");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"requestbin.com");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"ngrok.io");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"pipedream.net");
```

### Allow specific APIs

```cedar
permit(principal is Jans::Workload, action == Jans::Action::"call_api", resource == Jans::API::"api.github.com");
permit(principal is Jans::Workload, action == Jans::Action::"call_api", resource == Jans::API::"registry.npmjs.org");
permit(principal is Jans::Workload, action == Jans::Action::"call_api", resource == Jans::API::"api.yourcompany.com");
```

### Read-only API access

```cedar
permit(
  principal is Jans::Workload,
  action == Jans::Action::"call_api",
  resource == Jans::API::"api.github.com"
) when {
  context.method == "GET"
};
```

### Block social media posting

```cedar
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"api.twitter.com");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"api.x.com");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"graph.facebook.com");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"api.linkedin.com");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"discord.com");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"slack.com");
```

### Block localhost/internal network

```cedar
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"127.0.0.1");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"0.0.0.0");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"localhost");
```

---

## MCP Tool Policies

### Block destructive file tools

```cedar
forbid(principal, action == Jans::Action::"call_tool", resource == Jans::Tool::"filesystem/write_file");
forbid(principal, action == Jans::Action::"call_tool", resource == Jans::Tool::"filesystem/move_file");
forbid(principal, action == Jans::Action::"call_tool", resource == Jans::Tool::"filesystem/delete_file");
```

### Block email mass operations

```cedar
forbid(principal, action == Jans::Action::"call_tool", resource == Jans::Tool::"email/delete_all");
forbid(principal, action == Jans::Action::"call_tool", resource == Jans::Tool::"email/empty_trash");
forbid(principal, action == Jans::Action::"call_tool", resource == Jans::Tool::"email/send_bulk");
```

### Read-only database access

```cedar
forbid(principal, action == Jans::Action::"call_tool", resource == Jans::Tool::"database/execute_sql");
permit(principal is Jans::Workload, action == Jans::Action::"call_tool", resource == Jans::Tool::"database/query");
```

---

## Complete Starter Configurations

### "Cautious developer"

Good default for a coding agent. Allows dev tools, blocks destruction and exfiltration.

```cedar
// Dev tools
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

// Hard blocks
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"rm");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"sudo");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"security");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"bash");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"sh");

// APIs
permit(principal is Jans::Workload, action == Jans::Action::"call_api", resource == Jans::API::"api.github.com");
permit(principal is Jans::Workload, action == Jans::Action::"call_api", resource == Jans::API::"registry.npmjs.org");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"pastebin.com");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"webhook.site");

// MCP: allow all tools
permit(principal is Jans::Workload, action == Jans::Action::"call_tool", resource);
```

### "Research assistant"

Read-only access. Can browse and search but can't modify anything.

```cedar
// Read-only shell
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"cat");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"ls");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"grep");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"find");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"wc");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"head");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"tail");

// Read-only APIs (GET only)
permit(
  principal is Jans::Workload,
  action == Jans::Action::"call_api",
  resource
) when {
  context.method == "GET"
};

// Read-only MCP
permit(principal is Jans::Workload, action == Jans::Action::"call_tool", resource == Jans::Tool::"filesystem/read_file");
permit(principal is Jans::Workload, action == Jans::Action::"call_tool", resource == Jans::Tool::"filesystem/list_directory");
```

### "Paranoid lockdown"

Deny-all baseline. Nothing works unless explicitly permitted.

Set `defaultPolicy: "deny-all"` in config, then:

```cedar
// The absolute minimum for a useful agent
permit(principal is Jans::Workload, action == Jans::Action::"call_tool", resource == Jans::Tool::"filesystem/read_file");
permit(principal is Jans::Workload, action == Jans::Action::"call_tool", resource == Jans::Tool::"filesystem/list_directory");
permit(principal is Jans::Workload, action == Jans::Action::"exec_command", resource == Jans::Shell::"git");

// No API access, no shell writes, no nothing else
```

### "Social media manager"

Can post to specific platforms via MCP tools, but not via raw API access.

```cedar
// Allow posting through the managed MCP tool (has its own guardrails)
permit(principal is Jans::Workload, action == Jans::Action::"call_tool", resource == Jans::Tool::"twitter/post_tweet");
permit(principal is Jans::Workload, action == Jans::Action::"call_tool", resource == Jans::Tool::"twitter/read_timeline");

// Block raw API access to social platforms (bypass prevention)
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"api.twitter.com");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"api.x.com");

// Block all shell access (social media agent doesn't need it)
forbid(principal, action == Jans::Action::"exec_command", resource);

// Block exfiltration
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"pastebin.com");
forbid(principal, action == Jans::Action::"call_api", resource == Jans::API::"webhook.site");
```

---

## Policy Design Principles

1. **Forbid the catastrophic first.** Block `rm`, `sudo`, and exfil domains before anything else.

2. **Forbid always wins.** A `forbid` overrides any `permit` — write broad permits and surgical forbids.

3. **Binary name is the gate.** `Shell::"git"` permits *all* git commands. For subcommand control, use `when` conditions on `context.args`:

   ```cedar
   forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"git")
     when { context.args like "*push*--force*" };
   ```

4. **Domain name is the gate.** `API::"api.github.com"` permits all endpoints. For path/method control, use `when` conditions.

5. **Start with allow-all + forbids.** Switch to deny-all only when you understand your agent's full tool surface.

6. **Review regularly.** Open the GUI, look at what's enabled, adjust.

---

## Further Reading

- [Security Hardening Guide](SECURITY.md) — OS-level protections, credential protection, enforcement coverage
- [Cedar blog series](https://clawdrey.com/blog/cedar-for-ai-agents-part-1-why-your-ai-agent-needs-a-policy-language.html)
- [Cedar Language Reference](https://docs.cedarpolicy.com/)
- [Carapace README](../README.md)
