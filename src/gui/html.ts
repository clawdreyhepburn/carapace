/**
 * Single-file GUI for Carapace.
 * Returns complete HTML with embedded CSS and JS — no build step needed.
 */

export function guiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Carapace</title>
  <style>
    :root {
      --bg: #0a0a0a;
      --surface: #1a1a1a;
      --surface-2: #222;
      --border: #2a2a2a;
      --border-focus: #444;
      --text: #f5f0eb;
      --muted: #8a8078;
      --gold: #c4a87c;
      --gold-dim: rgba(196, 168, 124, 0.15);
      --tiffany: #81d8d0;
      --tiffany-dim: rgba(129, 216, 208, 0.1);
      --red: #e06060;
      --red-dim: rgba(224, 96, 96, 0.1);
      --green: #60c080;
      --green-dim: rgba(96, 192, 128, 0.1);
      --purple: #b090d0;
      --purple-dim: rgba(176, 144, 208, 0.1);
      --blue: #60a0e0;
      --blue-dim: rgba(96, 160, 224, 0.1);
      --orange: #e0a060;
      --orange-dim: rgba(224, 160, 96, 0.1);

      /* Category colors */
      --cat-read: var(--tiffany);
      --cat-read-dim: var(--tiffany-dim);
      --cat-browse: var(--blue);
      --cat-browse-dim: var(--blue-dim);
      --cat-write: var(--orange);
      --cat-write-dim: var(--orange-dim);
      --cat-execute: var(--red);
      --cat-execute-dim: var(--red-dim);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--bg); color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px; line-height: 1.6;
    }

    header {
      border-bottom: 1px solid var(--border);
      padding: 1rem 2rem;
      display: flex; align-items: center; justify-content: space-between;
    }
    header h1 { font-size: 1.2rem; font-weight: 600; color: var(--gold); }
    header .stats { color: var(--muted); font-size: 0.85rem; }
    header .stats .count { color: var(--tiffany); font-weight: 600; }

    .container { max-width: 1200px; margin: 0 auto; padding: 1.5rem 2rem; }

    /* Server cards */
    .servers {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem; margin-bottom: 1.5rem;
    }
    .server-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 1rem;
    }
    .server-card .name {
      font-weight: 600; margin-bottom: 0.25rem;
      display: flex; align-items: center; gap: 0.5rem;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .dot.connected { background: var(--green); }
    .dot.disconnected { background: var(--red); }
    .server-card .meta { color: var(--muted); font-size: 0.85rem; }

    h2 {
      font-size: 1rem; color: var(--gold); margin-bottom: 1rem;
      padding-bottom: 0.5rem; border-bottom: 1px solid var(--border);
    }

    /* ── Filter bar ── */
    .filter-bar {
      display: flex; gap: 0.75rem; margin-bottom: 1rem;
      align-items: center; flex-wrap: wrap;
    }
    .search-box {
      background: var(--surface); border: 1px solid var(--border);
      color: var(--text); padding: 0.4rem 0.75rem; border-radius: 6px;
      font-size: 0.85rem; width: 220px;
    }
    .search-box:focus { border-color: var(--gold); outline: none; }
    .search-box::placeholder { color: var(--muted); }

    .filter-group {
      display: flex; gap: 0; border-radius: 6px; overflow: hidden;
    }
    .filter-btn {
      padding: 0.35rem 0.75rem; border: 1px solid var(--border);
      background: transparent; color: var(--muted); cursor: pointer;
      font-size: 0.8rem; transition: all 0.15s; white-space: nowrap;
      margin-left: -1px;
    }
    .filter-btn:first-child { margin-left: 0; border-radius: 6px 0 0 6px; }
    .filter-btn:last-child { border-radius: 0 6px 6px 0; }
    .filter-btn.active { background: var(--surface); color: var(--text); border-color: var(--border-focus); }
    .filter-btn:hover { color: var(--text); }

    /* Category filter buttons with color indicators */
    .cat-btn { position: relative; padding-left: 1.5rem; }
    .cat-btn::before {
      content: ''; position: absolute; left: 0.5rem; top: 50%; transform: translateY(-50%);
      width: 8px; height: 8px; border-radius: 2px;
    }
    .cat-btn[data-cat="read"]::before { background: var(--cat-read); }
    .cat-btn[data-cat="browse"]::before { background: var(--cat-browse); }
    .cat-btn[data-cat="write"]::before { background: var(--cat-write); }
    .cat-btn[data-cat="execute"]::before { background: var(--cat-execute); }
    .cat-btn[data-cat="read"].active { border-color: var(--cat-read); color: var(--cat-read); }
    .cat-btn[data-cat="browse"].active { border-color: var(--cat-browse); color: var(--cat-browse); }
    .cat-btn[data-cat="write"].active { border-color: var(--cat-write); color: var(--cat-write); }
    .cat-btn[data-cat="execute"].active { border-color: var(--cat-execute); color: var(--cat-execute); }

    .filter-label { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }

    select.filter-select {
      background: var(--surface); border: 1px solid var(--border);
      color: var(--text); padding: 0.35rem 0.5rem; border-radius: 6px;
      font-size: 0.8rem; cursor: pointer;
    }
    select.filter-select:focus { border-color: var(--gold); outline: none; }
    select.filter-select option { background: var(--surface); }

    /* Tools table */
    .tools-table { width: 100%; border-collapse: collapse; }
    .tools-table th {
      text-align: left; padding: 0.5rem 0.75rem; color: var(--muted);
      font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em;
      border-bottom: 1px solid var(--border); cursor: pointer; user-select: none;
      white-space: nowrap;
    }
    .tools-table th:hover { color: var(--gold); }
    .tools-table th .sort-arrow { font-size: 0.65rem; margin-left: 0.25rem; }
    .tools-table td {
      padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); vertical-align: middle;
    }
    .tools-table tr:hover { background: rgba(255,255,255,0.02); }
    .tools-table tr.cat-write { border-left: 3px solid var(--cat-write); }
    .tools-table tr.cat-execute { border-left: 3px solid var(--cat-execute); }
    .tools-table tr.cat-read { border-left: 3px solid var(--cat-read); }
    .tools-table tr.cat-browse { border-left: 3px solid var(--cat-browse); }

    .tool-name { font-weight: 500; font-family: monospace; font-size: 0.9rem; }
    .tool-server { color: var(--muted); font-size: 0.85rem; }
    .tool-desc { color: var(--muted); font-size: 0.82rem; max-width: 350px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tool-desc:hover { white-space: normal; overflow: visible; }

    /* Category badge */
    .cat-badge {
      display: inline-flex; align-items: center; gap: 0.3rem;
      font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.04em; padding: 0.15rem 0.5rem; border-radius: 4px;
      white-space: nowrap;
    }
    .cat-badge.read { background: var(--cat-read-dim); color: var(--cat-read); }
    .cat-badge.browse { background: var(--cat-browse-dim); color: var(--cat-browse); }
    .cat-badge.write { background: var(--cat-write-dim); color: var(--cat-write); }
    .cat-badge.execute { background: var(--cat-execute-dim); color: var(--cat-execute); }

    /* Toggle switch */
    .toggle { position: relative; width: 36px; height: 20px; cursor: pointer; }
    .toggle input { display: none; }
    .toggle .slider {
      position: absolute; inset: 0; background: var(--border);
      border-radius: 10px; transition: background 0.2s;
    }
    .toggle .slider::before {
      content: ''; position: absolute; width: 14px; height: 14px;
      left: 3px; top: 3px; background: var(--muted);
      border-radius: 50%; transition: all 0.2s;
    }
    .toggle input:checked + .slider { background: var(--green); }
    .toggle input:checked + .slider::before { transform: translateX(16px); background: white; }

    /* Empty state */
    .empty-state { text-align: center; padding: 3rem; color: var(--muted); }

    /* Results count */
    .results-count { font-size: 0.8rem; color: var(--muted); margin-left: auto; white-space: nowrap; }

    /* ── Tab & action bar ── */
    .actions {
      display: flex; gap: 0.75rem; margin-bottom: 1rem; align-items: center; flex-wrap: wrap;
    }
    button {
      background: var(--surface); border: 1px solid var(--border);
      color: var(--text); padding: 0.5rem 1rem; border-radius: 6px;
      cursor: pointer; font-size: 0.85rem; transition: all 0.2s;
    }
    button:hover { border-color: var(--gold); color: var(--gold); }
    button.primary { border-color: var(--tiffany); color: var(--tiffany); }
    button.primary:hover { background: var(--tiffany-dim); }
    button.danger { border-color: var(--red); color: var(--red); }
    button.danger:hover { background: var(--red-dim); }
    .verify-status { color: var(--muted); font-size: 0.85rem; line-height: 36px; }
    .verify-status.ok { color: var(--green); }
    .verify-status.fail { color: var(--red); }

    .tabs { display: flex; gap: 0; }
    .tab {
      padding: 0.5rem 1.25rem; border: 1px solid var(--border);
      background: transparent; color: var(--muted); cursor: pointer; font-size: 0.85rem;
    }
    .tab:first-child { border-radius: 6px 0 0 6px; }
    .tab:last-child { border-radius: 0 6px 6px 0; }
    .tab.active { background: var(--surface); color: var(--gold); border-color: var(--gold); }

    /* ── Policies Tab ── */
    .policy-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; margin-bottom: 0.75rem; overflow: hidden;
    }
    .policy-card:hover { border-color: var(--border-focus); }
    .policy-card.permit { border-left: 3px solid var(--green); }
    .policy-card.forbid { border-left: 3px solid var(--red); }
    .policy-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.75rem 1rem; cursor: pointer; user-select: none;
    }
    .policy-header:hover { background: rgba(255,255,255,0.02); }
    .policy-header .left { display: flex; align-items: center; gap: 0.75rem; }
    .effect-badge {
      font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
      padding: 0.15rem 0.5rem; border-radius: 4px; letter-spacing: 0.04em;
    }
    .effect-badge.permit { background: var(--green-dim); color: var(--green); }
    .effect-badge.forbid { background: var(--red-dim); color: var(--red); }
    .policy-header .policy-id { font-family: monospace; font-size: 0.85rem; color: var(--muted); }
    .policy-header .chevron { color: var(--muted); transition: transform 0.2s; font-size: 0.8rem; }
    .policy-card.expanded .chevron { transform: rotate(90deg); }
    .policy-header .right { display: flex; gap: 0.5rem; align-items: center; }
    .policy-body { display: none; padding: 0 1rem 1rem; border-top: 1px solid var(--border); }
    .policy-card.expanded .policy-body { display: block; padding-top: 0.75rem; }
    .policy-editor {
      width: 100%; min-height: 120px; background: var(--bg);
      border: 1px solid var(--border); border-radius: 6px;
      color: var(--text); font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.85rem; padding: 0.75rem; line-height: 1.6; resize: vertical;
    }
    .policy-editor:focus { border-color: var(--gold); outline: none; }
    .policy-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; justify-content: flex-end; }

    /* ── Policy Builder ── */
    .builder-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.6); z-index: 100;
      justify-content: center; align-items: center;
    }
    .builder-overlay.open { display: flex; }
    .builder {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; width: 640px; max-height: 90vh;
      overflow-y: auto; padding: 1.5rem;
    }
    .builder h3 {
      font-size: 1.1rem; color: var(--gold); margin-bottom: 1rem;
      padding-bottom: 0.5rem; border-bottom: 1px solid var(--border);
    }
    .builder-row {
      display: grid; grid-template-columns: 120px 1fr;
      gap: 0.75rem; margin-bottom: 0.75rem; align-items: center;
    }
    .builder-row label { font-size: 0.85rem; color: var(--muted); text-align: right; font-weight: 500; }
    .builder select, .builder input[type="text"] {
      background: var(--bg); border: 1px solid var(--border);
      color: var(--text); padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.85rem; width: 100%;
    }
    .builder select:focus, .builder input:focus { border-color: var(--gold); outline: none; }
    .builder select option { background: var(--surface); }
    .builder-preview {
      background: var(--bg); border: 1px solid var(--border);
      border-radius: 6px; padding: 0.75rem; margin-top: 1rem;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.85rem; line-height: 1.6; white-space: pre;
      color: var(--tiffany); min-height: 80px;
    }
    .builder-footer {
      display: flex; justify-content: flex-end; gap: 0.75rem;
      margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border);
    }
    .condition-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center; }
    .condition-row select, .condition-row input {
      background: var(--bg); border: 1px solid var(--border);
      color: var(--text); padding: 0.4rem 0.6rem; border-radius: 4px; font-size: 0.8rem;
    }
    .condition-row select { width: 140px; }
    .condition-row input { flex: 1; }
    .condition-row .remove-cond { background: none; border: none; color: var(--red); cursor: pointer; font-size: 1rem; padding: 0 0.25rem; }
    .add-condition {
      font-size: 0.8rem; color: var(--tiffany); background: none;
      border: 1px dashed var(--border); padding: 0.3rem 0.75rem; border-radius: 4px; cursor: pointer;
    }
    .add-condition:hover { border-color: var(--tiffany); }

    /* Schema tab */
    .schema-editor {
      width: 100%; min-height: 300px; background: var(--bg);
      border: 1px solid var(--border); border-radius: 6px;
      color: var(--text); font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.85rem; padding: 0.75rem; line-height: 1.6; resize: vertical;
    }
    .schema-editor:focus { border-color: var(--gold); outline: none; }

    /* Toast */
    .toast {
      position: fixed; bottom: 1.5rem; right: 1.5rem;
      padding: 0.75rem 1.25rem; border-radius: 8px;
      font-size: 0.85rem; z-index: 200;
      animation: slideIn 0.3s ease, fadeOut 0.3s ease 2.7s;
      pointer-events: none;
    }
    .toast.success { background: var(--green-dim); color: var(--green); border: 1px solid var(--green); }
    .toast.error { background: var(--red-dim); color: var(--red); border: 1px solid var(--red); }
    @keyframes slideIn { from { transform: translateY(20px); opacity: 0; } }
    @keyframes fadeOut { to { opacity: 0; } }
  </style>
</head>
<body>
  <header>
    <h1>🦞 Carapace</h1>
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
        <button class="tab" data-tab="schema" onclick="switchTab('schema')">Schema</button>
      </div>
      <button class="primary" onclick="openBuilder()" id="new-policy-btn" style="display:none;">+ New Policy</button>
      <button class="primary" onclick="verify()" style="font-size:0.8rem;">⚡ Verify</button>
      <span class="verify-status" id="verify-status"></span>
      <button onclick="refresh()" style="margin-left: auto;">↻ Refresh</button>
    </div>

    <!-- Tools Tab -->
    <div id="tab-tools">
      <!-- Filter bar -->
      <div class="filter-bar">
        <input type="text" class="search-box" id="search-box" placeholder="Search tools..." oninput="renderTools()">

        <span class="filter-label">Type</span>
        <div class="filter-group" id="cat-filters">
          <button class="filter-btn cat-btn active" data-cat="all" onclick="toggleCatFilter('all')">All</button>
          <button class="filter-btn cat-btn active" data-cat="write" onclick="toggleCatFilter('write')">✏️ Write</button>
          <button class="filter-btn cat-btn active" data-cat="execute" onclick="toggleCatFilter('execute')">⚡ Execute</button>
          <button class="filter-btn cat-btn active" data-cat="browse" onclick="toggleCatFilter('browse')">🔍 Browse</button>
          <button class="filter-btn cat-btn active" data-cat="read" onclick="toggleCatFilter('read')">📖 Read</button>
        </div>

        <span class="filter-label">Status</span>
        <div class="filter-group">
          <button class="filter-btn active" data-status="all" onclick="setStatusFilter('all')">All</button>
          <button class="filter-btn" data-status="enabled" onclick="setStatusFilter('enabled')">Enabled</button>
          <button class="filter-btn" data-status="disabled" onclick="setStatusFilter('disabled')">Disabled</button>
        </div>

        <span class="filter-label">Server</span>
        <select class="filter-select" id="server-filter" onchange="renderTools()">
          <option value="all">All servers</option>
        </select>

        <span class="results-count" id="results-count"></span>
      </div>

      <table class="tools-table">
        <thead>
          <tr>
            <th onclick="setSort('enabled')" style="width:60px;">On <span class="sort-arrow" id="sort-enabled"></span></th>
            <th onclick="setSort('category')" style="width:90px;">Type <span class="sort-arrow" id="sort-category"></span></th>
            <th onclick="setSort('name')">Tool <span class="sort-arrow" id="sort-name"></span></th>
            <th onclick="setSort('server')" style="width:100px;">Server <span class="sort-arrow" id="sort-server"></span></th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody id="tools-body">
          <tr><td colspan="5" class="empty-state">Loading...</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Policies Tab -->
    <div id="tab-policies" style="display:none;">
      <div id="policies-list"></div>
    </div>

    <!-- Schema Tab -->
    <div id="tab-schema" style="display:none;">
      <p style="color:var(--muted);font-size:0.85rem;margin-bottom:0.75rem;">
        Cedar schema defines entity types, actions, and their relationships. Changes here affect what the policy builder offers.
      </p>
      <textarea class="schema-editor" id="schema-editor" spellcheck="false"></textarea>
      <div style="display:flex;gap:0.5rem;margin-top:0.75rem;justify-content:flex-end;">
        <button onclick="saveSchema()">Save Schema</button>
      </div>
    </div>
  </div>

  <!-- Policy Builder Modal -->
  <div class="builder-overlay" id="builder-overlay" onclick="if(event.target===this)closeBuilder()">
    <div class="builder">
      <h3 id="builder-title">New Policy</h3>
      <div class="builder-row">
        <label>Effect</label>
        <select id="b-effect" onchange="updatePreview()">
          <option value="permit">permit (allow)</option>
          <option value="forbid">forbid (deny)</option>
        </select>
      </div>
      <div class="builder-row">
        <label>Principal</label>
        <select id="b-principal-type" onchange="updatePreview()">
          <option value="any">Any principal</option>
        </select>
      </div>
      <div class="builder-row" id="b-principal-id-row" style="display:none;">
        <label>Principal ID</label>
        <input type="text" id="b-principal-id" placeholder='e.g. "openclaw"' oninput="updatePreview()">
      </div>
      <div class="builder-row">
        <label>Action</label>
        <select id="b-action" onchange="updatePreview()">
          <option value="any">Any action</option>
        </select>
      </div>
      <div class="builder-row">
        <label>Resource</label>
        <select id="b-resource-type" onchange="updateResourceOptions();updatePreview()">
          <option value="any">Any resource</option>
        </select>
      </div>
      <div class="builder-row" id="b-resource-id-row" style="display:none;">
        <label>Resource ID</label>
        <select id="b-resource-id" onchange="updatePreview()">
          <option value="">Select a tool...</option>
        </select>
      </div>
      <div class="builder-row" style="align-items:start;">
        <label style="margin-top:0.5rem;">Conditions</label>
        <div>
          <div id="b-conditions"></div>
          <button class="add-condition" onclick="addCondition()">+ Add condition</button>
        </div>
      </div>
      <div class="builder-row">
        <label>Policy ID</label>
        <input type="text" id="b-policy-id" placeholder="auto-generated" oninput="updatePreview()">
      </div>
      <div style="margin-top:1rem;">
        <label style="font-size:0.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;">Preview</label>
        <div class="builder-preview" id="b-preview"></div>
      </div>
      <div class="builder-footer">
        <button onclick="closeBuilder()">Cancel</button>
        <button class="primary" onclick="saveBuilderPolicy()">Save Policy</button>
      </div>
    </div>
  </div>

  <script>
    // ── State ──
    let state = { servers: {}, tools: [], policies: [], schema: null };
    let schema = { entities: [], actions: [], raw: '' };

    // Filter/sort state
    let activeCategories = new Set(['write', 'execute', 'browse', 'read']);
    let statusFilter = 'all';
    let sortField = 'category';
    let sortDir = 'asc'; // asc = risky first for category

    // ── Tool categorization ──
    const CAT_RULES = [
      // Write: modifies, creates, or moves data
      { cat: 'write', emoji: '✏️', patterns: [/write/, /edit/, /create/, /move/, /gzip/] },
      // Execute: triggers operations, toggles state, long-running
      { cat: 'execute', emoji: '⚡', patterns: [/toggle/, /trigger/, /simulate/, /long.?running/] },
      // Browse: lists, searches, inspects metadata
      { cat: 'browse', emoji: '🔍', patterns: [/list/, /search/, /tree/, /info/, /allowed/, /env$/, /annotated/, /reference/, /links/] },
      // Read: retrieves content
      { cat: 'read', emoji: '📖', patterns: [/read/, /echo/, /get/, /sum/, /image/, /structured/] },
    ];

    const CAT_ORDER = { write: 0, execute: 1, browse: 2, read: 3 };
    const CAT_LABELS = { write: '✏️ Write', execute: '⚡ Execute', browse: '🔍 Browse', read: '📖 Read' };

    function categorizeTool(name) {
      const lower = name.toLowerCase();
      for (const rule of CAT_RULES) {
        if (rule.patterns.some(p => p.test(lower))) return rule.cat;
      }
      return 'browse'; // default fallback
    }

    // ── Data fetching ──
    async function refresh() {
      try {
        const [statusRes, schemaRes] = await Promise.all([
          fetch('/api/status'), fetch('/api/schema')
        ]);
        state = await statusRes.json();
        schema = await schemaRes.json();
        // Enrich tools with category
        state.tools.forEach(t => { t.category = categorizeTool(t.name); });
        render();
      } catch (err) { console.error('Refresh failed:', err); }
    }

    // ── Rendering ──
    function render() {
      document.getElementById('total-count').textContent = state.toolCount ?? state.tools.length;
      document.getElementById('enabled-count').textContent = state.enabledCount ?? state.tools.filter(t => t.enabled).length;
      renderServers();
      renderTools();
      renderPolicies();
      renderSchemaEditor();
    }

    function renderServers() {
      const el = document.getElementById('servers');
      const serverFilter = document.getElementById('server-filter');
      el.innerHTML = Object.entries(state.servers).map(([name, s]) =>
        '<div class="server-card"><div class="name">' +
        '<span class="dot ' + (s.connected ? 'connected' : 'disconnected') + '"></span>' +
        esc(name) + '</div><div class="meta">' + s.toolCount + ' tools' +
        (s.error ? ' &middot; ' + esc(s.error) : '') + '</div></div>'
      ).join('');

      // Update server filter dropdown (preserve selection)
      const prev = serverFilter.value;
      serverFilter.innerHTML = '<option value="all">All servers</option>' +
        Object.keys(state.servers).map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
      serverFilter.value = prev || 'all';
    }

    function renderTools() {
      const search = document.getElementById('search-box').value.toLowerCase();
      const serverVal = document.getElementById('server-filter').value;

      // Filter
      let tools = state.tools.filter(t => {
        if (search && !t.qualifiedName.toLowerCase().includes(search) && !(t.description||'').toLowerCase().includes(search)) return false;
        if (!activeCategories.has(t.category)) return false;
        if (statusFilter === 'enabled' && !t.enabled) return false;
        if (statusFilter === 'disabled' && t.enabled) return false;
        if (serverVal !== 'all' && t.server !== serverVal) return false;
        return true;
      });

      // Sort
      tools.sort((a, b) => {
        let cmp = 0;
        if (sortField === 'category') cmp = (CAT_ORDER[a.category]??9) - (CAT_ORDER[b.category]??9);
        else if (sortField === 'name') cmp = a.qualifiedName.localeCompare(b.qualifiedName);
        else if (sortField === 'server') cmp = a.server.localeCompare(b.server);
        else if (sortField === 'enabled') cmp = (b.enabled?1:0) - (a.enabled?1:0);
        return sortDir === 'asc' ? cmp : -cmp;
      });

      // Update sort arrows
      ['enabled','category','name','server'].forEach(f => {
        const el = document.getElementById('sort-' + f);
        if (el) el.textContent = sortField === f ? (sortDir === 'asc' ? '▲' : '▼') : '';
      });

      // Results count
      document.getElementById('results-count').textContent =
        tools.length === state.tools.length ? '' : tools.length + ' of ' + state.tools.length;

      const tbody = document.getElementById('tools-body');
      if (tools.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No tools match filters</td></tr>';
        return;
      }

      tbody.innerHTML = tools.map(t => {
        const cat = t.category;
        return '<tr class="cat-' + cat + '">' +
          '<td><label class="toggle"><input type="checkbox" ' +
          (t.enabled ? 'checked' : '') +
          ' onchange="toggleTool(\\'' + esc(t.qualifiedName) + '\\',this.checked)">' +
          '<span class="slider"></span></label></td>' +
          '<td><span class="cat-badge ' + cat + '">' + CAT_LABELS[cat] + '</span></td>' +
          '<td class="tool-name" style="color:var(--cat-' + cat + ')">' + esc(t.qualifiedName) + '</td>' +
          '<td class="tool-server">' + esc(t.server) + '</td>' +
          '<td class="tool-desc" title="' + esc(t.description||'') + '">' + esc(t.description || '—') + '</td>' +
          '</tr>';
      }).join('');
    }

    // ── Filter controls ──
    function toggleCatFilter(cat) {
      if (cat === 'all') {
        // If all are active, deactivate all. If any are inactive, activate all.
        const allActive = activeCategories.size === 4;
        activeCategories = allActive ? new Set() : new Set(['write','execute','browse','read']);
      } else {
        if (activeCategories.has(cat)) activeCategories.delete(cat);
        else activeCategories.add(cat);
      }
      // Update button states
      document.querySelectorAll('#cat-filters .cat-btn').forEach(btn => {
        const c = btn.dataset.cat;
        if (c === 'all') {
          btn.classList.toggle('active', activeCategories.size === 4);
        } else {
          btn.classList.toggle('active', activeCategories.has(c));
        }
      });
      renderTools();
    }

    function setStatusFilter(val) {
      statusFilter = val;
      document.querySelectorAll('[data-status]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.status === val);
      });
      renderTools();
    }

    function setSort(field) {
      if (sortField === field) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortField = field; sortDir = 'asc'; }
      renderTools();
    }

    // ── Tool toggling ──
    async function toggleTool(tool, enabled) {
      try {
        await fetch('/api/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool, enabled })
        });
        await refresh();
        toast(tool + (enabled ? ' enabled' : ' disabled'), 'success');
      } catch (err) { toast('Toggle failed: ' + err, 'error'); }
    }

    // ── Policies ──
    function renderPolicies() {
      const el = document.getElementById('policies-list');
      const policies = state.policies ?? [];
      if (policies.length === 0) {
        el.innerHTML = '<div class="empty-state">No policies loaded. Default deny is active.<br><br>' +
          '<button class="primary" onclick="openBuilder()">+ Create your first policy</button></div>';
        return;
      }
      el.innerHTML = policies.map(p =>
        '<div class="policy-card ' + esc(p.effect) + '" id="pc-' + esc(p.id) + '">' +
          '<div class="policy-header" onclick="togglePolicy(\\'' + esc(p.id) + '\\')">' +
            '<div class="left">' +
              '<span class="chevron">▶</span>' +
              '<span class="effect-badge ' + esc(p.effect) + '">' + esc(p.effect) + '</span>' +
              '<span class="policy-id">' + esc(p.id) + '</span>' +
            '</div>' +
            '<div class="right">' +
              '<button onclick="event.stopPropagation();editPolicy(\\'' + esc(p.id) + '\\')" style="padding:0.25rem 0.5rem;font-size:0.8rem;">✏️ Edit</button>' +
              '<button class="danger" onclick="event.stopPropagation();deletePolicy(\\'' + esc(p.id) + '\\')" style="padding:0.25rem 0.5rem;font-size:0.8rem;">🗑</button>' +
            '</div>' +
          '</div>' +
          '<div class="policy-body">' +
            '<textarea class="policy-editor" id="pe-' + esc(p.id) + '" spellcheck="false">' + esc(p.raw) + '</textarea>' +
            '<div class="policy-actions">' +
              '<button class="danger" onclick="deletePolicy(\\'' + esc(p.id) + '\\')">Delete</button>' +
              '<button class="primary" onclick="saveInlinePolicy(\\'' + esc(p.id) + '\\')">Save Changes</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      ).join('');
    }

    function togglePolicy(id) {
      const el = document.getElementById('pc-' + id);
      if (el) el.classList.toggle('expanded');
    }

    async function saveInlinePolicy(id) {
      const el = document.getElementById('pe-' + id);
      if (!el) return;
      try {
        await fetch('/api/policy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, raw: el.value })
        });
        await refresh(); toast('Policy saved: ' + id, 'success');
      } catch (err) { toast('Save failed: ' + err, 'error'); }
    }

    async function deletePolicy(id) {
      if (!confirm('Delete policy "' + id + '"?')) return;
      try {
        await fetch('/api/policy', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        await refresh(); toast('Policy deleted: ' + id, 'success');
      } catch (err) { toast('Delete failed: ' + err, 'error'); }
    }

    function editPolicy(id) {
      const el = document.getElementById('pc-' + id);
      if (el && !el.classList.contains('expanded')) el.classList.add('expanded');
      const editor = document.getElementById('pe-' + id);
      if (editor) editor.focus();
    }

    // ── Schema ──
    function renderSchemaEditor() {
      const el = document.getElementById('schema-editor');
      if (el && !el.matches(':focus')) el.value = schema.raw || '';
    }

    async function saveSchema() {
      const raw = document.getElementById('schema-editor').value;
      try {
        await fetch('/api/schema', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw })
        });
        await refresh(); toast('Schema saved', 'success');
      } catch (err) { toast('Schema save failed: ' + err, 'error'); }
    }

    // ── Verify ──
    async function verify() {
      const el = document.getElementById('verify-status');
      el.textContent = 'Verifying...'; el.className = 'verify-status';
      try {
        const res = await fetch('/api/verify', { method: 'POST' });
        const result = await res.json();
        if (result.ok) { el.textContent = '✅ Verified (' + result.durationMs + 'ms)'; el.className = 'verify-status ok'; }
        else { el.textContent = '⚠️ ' + result.issues.join('; '); el.className = 'verify-status fail'; }
      } catch (err) { el.textContent = '❌ Error'; el.className = 'verify-status fail'; }
    }

    // ── Tab switching ──
    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelector('[data-tab="' + tab + '"]').classList.add('active');
      ['tools', 'policies', 'schema'].forEach(t => {
        document.getElementById('tab-' + t).style.display = t === tab ? '' : 'none';
      });
      document.getElementById('new-policy-btn').style.display = (tab === 'policies') ? '' : 'none';
    }

    // ── Policy Builder ──
    function openBuilder() {
      populateBuilderDropdowns();
      document.getElementById('b-effect').value = 'permit';
      document.getElementById('b-principal-type').value = 'any';
      document.getElementById('b-principal-id').value = '';
      document.getElementById('b-principal-id-row').style.display = 'none';
      document.getElementById('b-action').value = 'any';
      document.getElementById('b-resource-type').value = 'any';
      document.getElementById('b-resource-id-row').style.display = 'none';
      document.getElementById('b-conditions').innerHTML = '';
      document.getElementById('b-policy-id').value = '';
      document.getElementById('b-policy-id').dataset.auto = '1';
      document.getElementById('builder-title').textContent = 'New Policy';
      updatePreview();
      document.getElementById('builder-overlay').classList.add('open');
    }
    function closeBuilder() { document.getElementById('builder-overlay').classList.remove('open'); }

    function populateBuilderDropdowns() {
      const princSelect = document.getElementById('b-principal-type');
      princSelect.innerHTML = '<option value="any">Any principal</option>';
      for (const e of schema.entities ?? []) {
        princSelect.innerHTML += '<option value="specific:' + e.name + '">' + e.name + ' (specific)</option>';
        princSelect.innerHTML += '<option value="type:' + e.name + '">All ' + e.name + '</option>';
      }
      const actSelect = document.getElementById('b-action');
      actSelect.innerHTML = '<option value="any">Any action</option>';
      for (const a of schema.actions ?? []) {
        actSelect.innerHTML += '<option value="' + a.name + '">' + a.name + '</option>';
      }
      const resSelect = document.getElementById('b-resource-type');
      resSelect.innerHTML = '<option value="any">Any resource</option>';
      for (const e of schema.entities ?? []) {
        resSelect.innerHTML += '<option value="specific:' + e.name + '">' + e.name + ' (specific)</option>';
        resSelect.innerHTML += '<option value="type:' + e.name + '">All ' + e.name + '</option>';
      }
    }

    function updateResourceOptions() {
      const val = document.getElementById('b-resource-type').value;
      const idRow = document.getElementById('b-resource-id-row');
      if (val.startsWith('specific:')) {
        idRow.style.display = '';
        const resIdSelect = document.getElementById('b-resource-id');
        resIdSelect.innerHTML = '<option value="">Select...</option>';
        if (val === 'specific:Tool') {
          for (const t of state.tools ?? []) {
            resIdSelect.innerHTML += '<option value="' + esc(t.qualifiedName) + '">' + esc(t.qualifiedName) + '</option>';
          }
        }
        resIdSelect.innerHTML += '<option value="__custom__">Custom ID...</option>';
      } else { idRow.style.display = 'none'; }
      const princVal = document.getElementById('b-principal-type').value;
      document.getElementById('b-principal-id-row').style.display = princVal.startsWith('specific:') ? '' : 'none';
    }

    function addCondition() {
      const container = document.getElementById('b-conditions');
      const row = document.createElement('div');
      row.className = 'condition-row';
      let attrOpts = '<option value="">attribute...</option>';
      for (const e of schema.entities ?? []) {
        for (const a of e.attributes ?? []) {
          attrOpts += '<option value="resource.' + a.name + '">' + a.name + ' (' + a.type + ')</option>';
        }
      }
      attrOpts += '<option value="context.arguments">context.arguments</option>';
      row.innerHTML =
        '<select onchange="updatePreview()">' + attrOpts + '</select>' +
        '<select onchange="updatePreview()" style="width:80px;"><option value="==">=</option><option value="!=">≠</option><option value="has">has</option><option value="in">in</option></select>' +
        '<input type="text" placeholder="value" oninput="updatePreview()">' +
        '<span class="remove-cond" onclick="this.parentElement.remove();updatePreview()">×</span>';
      container.appendChild(row);
      updatePreview();
    }

    function updatePreview() {
      const effect = document.getElementById('b-effect').value;
      const princType = document.getElementById('b-principal-type').value;
      const princId = document.getElementById('b-principal-id').value.trim();
      const action = document.getElementById('b-action').value;
      const resType = document.getElementById('b-resource-type').value;
      const resId = document.getElementById('b-resource-id')?.value ?? '';
      document.getElementById('b-principal-id-row').style.display = princType.startsWith('specific:') ? '' : 'none';
      updateResourceOptions();
      let lines = [effect + '('];
      if (princType === 'any') lines.push('  principal,');
      else if (princType.startsWith('specific:')) {
        const type = princType.split(':')[1];
        lines.push(princId ? '  principal == ' + type + '::"' + princId + '",' : '  principal is ' + type + ',');
      } else if (princType.startsWith('type:')) lines.push('  principal is ' + princType.split(':')[1] + ',');
      if (action === 'any') lines.push('  action,');
      else lines.push('  action == Action::"' + action + '",');
      if (resType === 'any') lines.push('  resource');
      else if (resType.startsWith('specific:')) {
        const type = resType.split(':')[1];
        lines.push(resId && resId !== '__custom__' ? '  resource == ' + type + '::"' + resId + '"' : '  resource is ' + type);
      } else if (resType.startsWith('type:')) lines.push('  resource is ' + resType.split(':')[1]);
      const condRows = document.querySelectorAll('#b-conditions .condition-row');
      const conds = [];
      condRows.forEach(row => {
        const selects = row.querySelectorAll('select');
        const input = row.querySelector('input');
        const attr = selects[0]?.value; const op = selects[1]?.value; const val = input?.value?.trim();
        if (attr && val) {
          if (op === 'has') conds.push(attr.split('.')[0] + ' has ' + val);
          else { const isLit = val==='true'||val==='false'||!isNaN(Number(val)); conds.push(attr+' '+op+' '+(isLit?val:'"'+val+'"')); }
        }
      });
      if (conds.length > 0) { lines.push(') when {'); lines.push('  ' + conds.join(' &&\\n  ')); lines.push('};'); }
      else lines.push(');');
      document.getElementById('b-preview').textContent = lines.join('\\n');
      const idInput = document.getElementById('b-policy-id');
      if (!idInput.value || idInput.dataset.auto === '1') {
        let autoId = effect;
        if (action !== 'any') autoId += '-' + action.replace(/_/g, '-');
        if (resId && resId !== '__custom__') autoId += '-' + resId.replace(/\\//g, '-');
        else if (resType !== 'any') autoId += '-' + resType.split(':')[1].toLowerCase();
        idInput.value = autoId; idInput.dataset.auto = '1';
      }
    }

    async function saveBuilderPolicy() {
      const id = document.getElementById('b-policy-id').value.trim();
      const raw = document.getElementById('b-preview').textContent;
      if (!id) { toast('Policy ID is required', 'error'); return; }
      try {
        await fetch('/api/policy', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({id,raw}) });
        closeBuilder(); await refresh(); toast('Policy created: ' + id, 'success'); switchTab('policies');
      } catch (err) { toast('Save failed: ' + err, 'error'); }
    }

    // ── Utilities ──
    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function toast(msg, type) {
      const el = document.createElement('div'); el.className = 'toast ' + type;
      el.textContent = msg; document.body.appendChild(el); setTimeout(() => el.remove(), 3000);
    }

    // ── Init ──
    refresh();
    setInterval(refresh, 5000);
    document.getElementById('b-policy-id')?.addEventListener('input', function() {
      if (this === document.activeElement) this.dataset.auto = '0';
    });
  </script>
</body>
</html>`;
}
