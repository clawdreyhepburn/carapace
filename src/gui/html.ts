/**
 * Single-file GUI for MCP Cedar Proxy.
 * Returns complete HTML with embedded CSS and JS — no build step needed.
 */

export function guiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP Cedar Proxy</title>
  <style>
    :root {
      --bg: #0a0a0a;
      --surface: #1a1a1a;
      --border: #2a2a2a;
      --text: #f5f0eb;
      --muted: #8a8078;
      --gold: #c4a87c;
      --tiffany: #81d8d0;
      --red: #e06060;
      --green: #60c080;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      line-height: 1.6;
    }

    header {
      border-bottom: 1px solid var(--border);
      padding: 1rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    header h1 {
      font-size: 1.2rem;
      font-weight: 600;
      color: var(--gold);
    }
    header .stats {
      color: var(--muted);
      font-size: 0.85rem;
    }
    header .stats .count { color: var(--tiffany); font-weight: 600; }

    .container { max-width: 1200px; margin: 0 auto; padding: 1.5rem 2rem; }

    /* Server cards */
    .servers {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .server-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
    }
    .server-card .name {
      font-weight: 600;
      margin-bottom: 0.25rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .server-card .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .dot.connected { background: var(--green); }
    .dot.disconnected { background: var(--red); }
    .server-card .meta { color: var(--muted); font-size: 0.85rem; }

    /* Section headers */
    h2 {
      font-size: 1rem;
      color: var(--gold);
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }

    /* Tools table */
    .tools-table {
      width: 100%;
      border-collapse: collapse;
    }
    .tools-table th {
      text-align: left;
      padding: 0.5rem 0.75rem;
      color: var(--muted);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--border);
    }
    .tools-table td {
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    .tools-table tr:hover { background: rgba(255,255,255,0.02); }
    .tool-name { font-weight: 500; color: var(--tiffany); font-family: monospace; font-size: 0.9rem; }
    .tool-server { color: var(--muted); font-size: 0.85rem; }
    .tool-desc { color: var(--muted); font-size: 0.85rem; max-width: 400px; }

    /* Toggle switch */
    .toggle {
      position: relative;
      width: 40px;
      height: 22px;
      cursor: pointer;
    }
    .toggle input { display: none; }
    .toggle .slider {
      position: absolute;
      inset: 0;
      background: var(--border);
      border-radius: 11px;
      transition: background 0.2s;
    }
    .toggle .slider::before {
      content: '';
      position: absolute;
      width: 16px;
      height: 16px;
      left: 3px;
      top: 3px;
      background: var(--muted);
      border-radius: 50%;
      transition: all 0.2s;
    }
    .toggle input:checked + .slider { background: var(--green); }
    .toggle input:checked + .slider::before {
      transform: translateX(18px);
      background: white;
    }

    /* Policies panel */
    .policies {
      margin-top: 2rem;
    }
    .policy-item {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      margin-bottom: 0.5rem;
      font-family: monospace;
      font-size: 0.85rem;
      color: var(--muted);
    }
    .policy-item .effect {
      font-weight: 600;
      margin-right: 0.5rem;
    }
    .effect.permit { color: var(--green); }
    .effect.forbid { color: var(--red); }

    /* Actions bar */
    .actions {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }
    button {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.2s;
    }
    button:hover { border-color: var(--gold); color: var(--gold); }
    button.verify { border-color: var(--tiffany); color: var(--tiffany); }
    button.verify:hover { background: rgba(129, 216, 208, 0.1); }

    .verify-status { color: var(--muted); font-size: 0.85rem; line-height: 36px; }
    .verify-status.ok { color: var(--green); }
    .verify-status.fail { color: var(--red); }

    /* Loading */
    .loading { text-align: center; padding: 3rem; color: var(--muted); }

    /* Tabs */
    .tabs { display: flex; gap: 0; margin-bottom: 1.5rem; }
    .tab {
      padding: 0.5rem 1.25rem;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font-size: 0.85rem;
    }
    .tab:first-child { border-radius: 6px 0 0 6px; }
    .tab:last-child { border-radius: 0 6px 6px 0; }
    .tab.active { background: var(--surface); color: var(--gold); border-color: var(--gold); }
  </style>
</head>
<body>
  <header>
    <h1>🦞 MCP Cedar Proxy</h1>
    <div class="stats">
      <span class="count" id="enabled-count">-</span> / <span class="count" id="total-count">-</span> tools enabled
    </div>
  </header>

  <div class="container">
    <div id="servers-section">
      <h2>Servers</h2>
      <div class="servers" id="servers"></div>
    </div>

    <div class="actions">
      <div class="tabs">
        <button class="tab active" data-tab="tools" onclick="switchTab('tools')">Tools</button>
        <button class="tab" data-tab="policies" onclick="switchTab('policies')">Policies</button>
      </div>
      <button class="verify" onclick="verify()">⚡ Verify Policies</button>
      <span class="verify-status" id="verify-status"></span>
      <button onclick="refresh()" style="margin-left: auto;">↻ Refresh</button>
    </div>

    <div id="tab-tools">
      <table class="tools-table">
        <thead>
          <tr>
            <th>Enabled</th>
            <th>Tool</th>
            <th>Server</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody id="tools-body">
          <tr><td colspan="4" class="loading">Loading...</td></tr>
        </tbody>
      </table>
    </div>

    <div id="tab-policies" style="display:none;">
      <div class="policies" id="policies-list"></div>
    </div>
  </div>

  <script>
    let state = { servers: {}, tools: [], policies: [] };

    async function refresh() {
      try {
        const res = await fetch('/api/status');
        state = await res.json();
        render();
      } catch (err) {
        console.error('Failed to fetch status:', err);
      }
    }

    function render() {
      // Stats
      document.getElementById('total-count').textContent = state.toolCount ?? state.tools.length;
      document.getElementById('enabled-count').textContent = state.enabledCount ?? state.tools.filter(t => t.enabled).length;

      // Servers
      const serversEl = document.getElementById('servers');
      serversEl.innerHTML = Object.entries(state.servers).map(([name, s]) => \`
        <div class="server-card">
          <div class="name">
            <span class="dot \${s.connected ? 'connected' : 'disconnected'}"></span>
            \${name}
          </div>
          <div class="meta">\${s.toolCount} tools\${s.error ? ' · ' + s.error : ''}</div>
        </div>
      \`).join('');

      // Tools
      const tbody = document.getElementById('tools-body');
      if (state.tools.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="loading">No tools discovered</td></tr>';
      } else {
        tbody.innerHTML = state.tools.map(t => \`
          <tr>
            <td>
              <label class="toggle">
                <input type="checkbox" \${t.enabled ? 'checked' : ''}
                  onchange="toggle('\${t.qualifiedName}', this.checked)">
                <span class="slider"></span>
              </label>
            </td>
            <td class="tool-name">\${t.qualifiedName}</td>
            <td class="tool-server">\${t.server}</td>
            <td class="tool-desc">\${t.description || '—'}</td>
          </tr>
        \`).join('');
      }

      // Policies
      const policiesEl = document.getElementById('policies-list');
      const policies = state.policies ?? [];
      if (policies.length === 0) {
        policiesEl.innerHTML = '<div class="loading">No policies (default deny)</div>';
      } else {
        policiesEl.innerHTML = policies.map(p => \`
          <div class="policy-item">
            <span class="effect \${p.effect}">\${p.effect}</span>
            \${escapeHtml(p.raw.replace(/\\n/g, ' ').replace(/\\s+/g, ' '))}
          </div>
        \`).join('');
      }
    }

    async function toggle(tool, enabled) {
      try {
        await fetch('/api/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool, enabled })
        });
        await refresh();
      } catch (err) {
        console.error('Toggle failed:', err);
      }
    }

    async function verify() {
      const el = document.getElementById('verify-status');
      el.textContent = 'Verifying...';
      el.className = 'verify-status';
      try {
        const res = await fetch('/api/verify', { method: 'POST' });
        const result = await res.json();
        if (result.ok) {
          el.textContent = '✅ Verified (' + result.durationMs + 'ms)';
          el.className = 'verify-status ok';
        } else {
          el.textContent = '⚠️ ' + result.issues.join('; ');
          el.className = 'verify-status fail';
        }
      } catch (err) {
        el.textContent = '❌ Error';
        el.className = 'verify-status fail';
      }
    }

    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelector('[data-tab="' + tab + '"]').classList.add('active');
      document.getElementById('tab-tools').style.display = tab === 'tools' ? '' : 'none';
      document.getElementById('tab-policies').style.display = tab === 'policies' ? '' : 'none';
    }

    function escapeHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // Initial load + auto-refresh
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;
}
