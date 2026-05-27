// @ts-nocheck
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();

    // ── State ─────────────────────────────────────────────────────────────────
    let activeTab = 'table';
    let lastResults = null; // { columns, dtypes, rows }

    // ── DOM refs (populated in buildLayout) ───────────────────────────────────
    let elSqlEditor, elSourcesContainer, elConnLabel,
        elResultsBody, elRowCount, elTabTable, elTabRaw;

    // ── Boot ──────────────────────────────────────────────────────────────────
    injectStyles();
    buildLayout();
    wireEvents();
    vscode.postMessage({ type: 'ready' });

    // ═════════════════════════════════════════════════════════════════════════
    // STYLES
    // ═════════════════════════════════════════════════════════════════════════
    function injectStyles() {
        const s = document.createElement('style');
        s.textContent = `
        *, *::before, *::after { box-sizing: border-box; }

        html, body {
            margin: 0; padding: 0;
            height: 100vh; overflow: hidden;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family, sans-serif);
            font-size: var(--vscode-font-size, 13px);
        }

        /* ── App shell ── */
        .app {
            display: flex;
            flex-direction: row;
            height: 100vh;
            overflow: hidden;
        }

        /* ── Sources pane ── */
        .sources-pane {
            width: 220px;
            min-width: 120px;
            max-width: 500px;
            display: flex;
            flex-direction: column;
            border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
            overflow: hidden;
            flex-shrink: 0;
        }

        .pane-toolbar {
            display: flex;
            gap: 4px;
            padding: 5px 6px;
            border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
            background: var(--vscode-sideBar-background, var(--vscode-editor-background));
            flex-shrink: 0;
        }

        .pane-toolbar button {
            flex: 1;
            padding: 3px 6px;
            font-size: 0.85em;
            background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
            color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
            border: none;
            border-radius: 2px;
            cursor: pointer;
        }
        .pane-toolbar button:hover {
            background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.25));
        }

        .sources-list {
            flex: 1;
            overflow-y: auto;
            padding: 4px 0;
        }

        /* Source row */
        .src-header {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 3px 8px;
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
        }
        .src-header:hover { background: var(--vscode-list-hoverBackground); }

        .src-toggle { font-size: 0.7em; width: 10px; flex-shrink: 0; }
        .src-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
        .src-badge {
            font-size: 0.75em;
            padding: 1px 4px;
            border-radius: 2px;
            background: var(--vscode-badge-background, rgba(128,128,128,0.2));
            color: var(--vscode-badge-foreground, var(--vscode-foreground));
            flex-shrink: 0;
        }
        .src-header.not-synced { opacity: 0.5; }
        .sync-needed { font-size: 0.78em; color: var(--vscode-descriptionForeground); flex-shrink: 0; }

        /* Column rows */
        .src-children { display: none; }
        .col-item {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px 2px 26px;
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
        }
        .col-item:hover { background: var(--vscode-list-hoverBackground); }
        .col-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
        .col-dtype { font-size: 0.8em; color: var(--vscode-descriptionForeground); flex-shrink: 0; }

        /* ── Drag divider ── */
        .vdivider {
            width: 5px;
            cursor: col-resize;
            background: transparent;
            flex-shrink: 0;
            transition: background 0.15s;
        }
        .vdivider:hover, .vdivider.dragging {
            background: var(--vscode-focusBorder, rgba(0,120,212,0.4));
        }

        /* ── Right pane ── */
        .right-pane {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            min-width: 0;
        }

        /* Connection bar */
        .conn-bar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 10px;
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
            background: var(--vscode-sideBar-background, var(--vscode-editor-background));
            flex-shrink: 0;
        }
        .conn-bar button.icon-btn {
            background: none;
            border: none;
            cursor: pointer;
            color: var(--vscode-descriptionForeground);
            padding: 0 4px;
            font-size: 1em;
            border-radius: 2px;
        }
        .conn-bar button.icon-btn:hover { background: var(--vscode-list-hoverBackground); }

        /* SQL editor area */
        .sql-area {
            display: flex;
            flex-direction: column;
            flex-shrink: 0;
            border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
        }

        #sql-editor {
            width: 100%;
            height: 160px;
            resize: vertical;
            padding: 8px 10px;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
            font-size: var(--vscode-editor-font-size, 13px);
            border: none;
            outline: none;
            border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
        }
        #sql-editor::placeholder { color: var(--vscode-input-placeholderForeground, rgba(128,128,128,0.6)); }

        .btn-row {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 8px;
            background: var(--vscode-sideBar-background, var(--vscode-editor-background));
        }

        .btn-row button {
            padding: 4px 12px;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: inherit;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        #btn-run {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        #btn-run:hover { background: var(--vscode-button-hoverBackground); }
        #btn-run kbd {
            font-size: 0.8em;
            opacity: 0.7;
            background: rgba(255,255,255,0.15);
            padding: 1px 4px;
            border-radius: 2px;
        }
        #btn-export, #btn-clear {
            background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
            color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        }
        #btn-export:hover, #btn-clear:hover {
            background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.25));
        }
        #btn-export:disabled { opacity: 0.4; cursor: not-allowed; }

        /* Results area */
        .results-pane {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            min-height: 0;
        }

        .tabs-bar {
            display: flex;
            align-items: center;
            padding: 0 8px;
            gap: 2px;
            border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
            background: var(--vscode-sideBar-background, var(--vscode-editor-background));
            flex-shrink: 0;
        }
        .tab {
            padding: 5px 12px;
            border: none;
            border-bottom: 2px solid transparent;
            background: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: inherit;
            opacity: 0.7;
        }
        .tab.active {
            opacity: 1;
            border-bottom-color: var(--vscode-focusBorder, #007acc);
        }
        .tab:hover:not(.active) { background: var(--vscode-list-hoverBackground); }
        .row-count { margin-left: auto; font-size: 0.85em; color: var(--vscode-descriptionForeground); }

        .results-body {
            flex: 1;
            overflow-x: auto;
            overflow-y: auto;
            min-height: 0;
        }

        /* Shared table styles */
        .table-wrap { } /* results-body owns all scrolling */
        table { border-collapse: collapse; min-width: max-content; width: 100%; }
        th {
            text-align: left;
            padding: 5px 12px;
            border-bottom: 2px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
            white-space: nowrap;
            background: var(--vscode-sideBar-background, var(--vscode-editor-background));
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 2;
        }
        td {
            padding: 3px 12px;
            border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.08));
            white-space: nowrap;
            max-width: 320px;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        tbody tr:nth-child(odd) td  { background: var(--vscode-editor-background); }
        tbody tr:nth-child(even) td { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.04)); }
        tbody tr:hover td { background: var(--vscode-list-hoverBackground); }
        td.null-cell { color: var(--vscode-disabledForeground, rgba(128,128,128,0.5)); font-style: italic; }

        /* Raw JSON */
        .raw-pre {
            margin: 0;
            padding: 12px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: var(--vscode-editor-font-size, 13px);
            white-space: pre-wrap;
            word-break: break-all;
            color: var(--vscode-editor-foreground);
        }

        /* States */
        .state {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px 16px;
            color: var(--vscode-descriptionForeground);
        }
        .spinner {
            width: 16px; height: 16px;
            border: 2px solid var(--vscode-foreground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.7s linear infinite;
            margin-right: 8px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .error-banner {
            margin: 12px;
            padding: 10px 14px;
            border-radius: 3px;
            background: var(--vscode-inputValidation-errorBackground, rgba(90,29,29,0.5));
            color: var(--vscode-inputValidation-errorForeground, #f48771);
            border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
        }

        .empty-hint {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            padding: 8px;
            text-align: center;
        }
        `;
        document.head.appendChild(s);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // LAYOUT
    // ═════════════════════════════════════════════════════════════════════════
    function buildLayout() {
        document.body.innerHTML = `
        <div class="app">
            <div class="sources-pane" id="sources-pane">
                <div class="pane-toolbar">
                    <button id="btn-refresh-src" title="Refresh sources">↻ Refresh</button>
                    <button id="btn-sync-src"    title="Save sources to parquet">⚡ Sync</button>
                </div>
                <div class="sources-list" id="sources-list">
                    <div class="state"><div class="spinner"></div></div>
                </div>
            </div>

            <div class="vdivider" id="vdivider"></div>

            <div class="right-pane">
                <div class="conn-bar" id="conn-bar">
                    <span id="conn-label">Not connected</span>
                    <button class="icon-btn" id="btn-conn-settings" title="Open connection settings">⚙</button>
                </div>

                <div class="sql-area">
                    <textarea id="sql-editor"
                        placeholder="-- Write your SQL query here&#10;-- Double-click a column on the left to insert it"
                        spellcheck="false"></textarea>
                    <div class="btn-row">
                        <button id="btn-run">▶ Run <kbd>Ctrl+Enter</kbd></button>
                        <button id="btn-export" title="Export results as CSV (Ctrl+Shift+E)">⬇ Export</button>
                        <button id="btn-clear">✕ Clear</button>
                    </div>
                </div>

                <div class="results-pane">
                    <div class="tabs-bar">
                        <button class="tab active" id="tab-table">Table</button>
                        <button class="tab"         id="tab-raw">Raw JSON</button>
                        <span class="row-count" id="row-count"></span>
                    </div>
                    <div class="results-body" id="results-body">
                        <div class="state">Run a query to see results.</div>
                    </div>
                </div>
            </div>
        </div>`;

        // Cache references
        elSqlEditor        = document.getElementById('sql-editor');
        elSourcesContainer = document.getElementById('sources-list');
        elConnLabel        = document.getElementById('conn-label');
        elResultsBody      = document.getElementById('results-body');
        elRowCount         = document.getElementById('row-count');
        elTabTable         = document.getElementById('tab-table');
        elTabRaw           = document.getElementById('tab-raw');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═════════════════════════════════════════════════════════════════════════
    function wireEvents() {
        // SQL editor keyboard shortcuts
        elSqlEditor.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                runQuery();
            }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
                e.preventDefault();
                requestExport();
            }
        });

        document.getElementById('btn-run').addEventListener('click', runQuery);
        document.getElementById('btn-export').addEventListener('click', requestExport);

        document.getElementById('btn-clear').addEventListener('click', () => {
            elSqlEditor.value = '';
            elSqlEditor.focus();
        });

        document.getElementById('btn-refresh-src').addEventListener('click', () => {
            vscode.postMessage({ type: 'refreshSources' });
        });

        document.getElementById('btn-sync-src').addEventListener('click', () => {
            vscode.postMessage({ type: 'syncSources' });
        });

        document.getElementById('btn-conn-settings').addEventListener('click', () => {
            vscode.postMessage({ type: 'openSettings' });
        });

        // Tabs
        elTabTable.addEventListener('click', () => setTab('table'));
        elTabRaw.addEventListener('click',   () => setTab('raw'));

        // Divider drag
        setupDivider();
    }

    function runQuery() {
        const query = elSqlEditor.value.trim();
        if (!query) { return; }
        vscode.postMessage({ type: 'runQuery', query });
    }

    function requestExport() {
        const query = elSqlEditor.value.trim();
        if (!query) { return; }
        vscode.postMessage({ type: 'export', query });
    }

    function setTab(tab) {
        activeTab = tab;
        elTabTable.classList.toggle('active', tab === 'table');
        elTabRaw.classList.toggle('active',   tab === 'raw');
        if (lastResults) { renderActiveTab(); }
    }

    // ── Resizable divider ─────────────────────────────────────────────────────
    function setupDivider() {
        const divider    = document.getElementById('vdivider');
        const sourcesPane = document.getElementById('sources-pane');

        divider.addEventListener('mousedown', e => {
            e.preventDefault();
            const startX     = e.clientX;
            const startWidth = sourcesPane.offsetWidth;
            divider.classList.add('dragging');
            document.body.style.userSelect = 'none';
            document.body.style.cursor     = 'col-resize';

            function onMove(e) {
                const w = Math.max(120, Math.min(500, startWidth + (e.clientX - startX)));
                sourcesPane.style.width = w + 'px';
            }
            function onUp() {
                divider.classList.remove('dragging');
                document.body.style.userSelect = '';
                document.body.style.cursor     = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup',   onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // MESSAGE HANDLING (from extension)
    // ═════════════════════════════════════════════════════════════════════════
    window.addEventListener('message', event => {
        const msg = event.data;
        switch (msg.type) {
            case 'sources':       renderSources(msg.sources); break;
            case 'results':       showResults(msg.columns, msg.dtypes, msg.rows); break;
            case 'loading':       showResultsLoading(); break;
            case 'error':         showResultsError(msg.message); break;
            case 'config':        updateConnBar(msg.host, msg.database, msg.user); break;
            case 'idle':          showResultsIdle(); break;
            case 'requestExport': requestExport(); break;
        }
    });

    // ═════════════════════════════════════════════════════════════════════════
    // SOURCES PANE
    // ═════════════════════════════════════════════════════════════════════════
    function renderSources(sources) {
        if (!sources || !sources.length) {
            elSourcesContainer.innerHTML = '<div class="empty-hint">No sources in workspace.</div>';
            return;
        }

        elSourcesContainer.innerHTML = '';

        for (const src of sources) {
            const synced = src.schema_source === 'parquet_artifact';
            const wrapper = document.createElement('div');

            // Header row
            const header = document.createElement('div');
            header.className = 'src-header' + (synced ? '' : ' not-synced');
            header.innerHTML = `
                <span class="src-toggle">${synced ? '▶' : ''}</span>
                <span class="src-name">${esc(src.name)}</span>
                <span class="src-badge">${esc(src.type)}</span>
                ${synced ? '' : '<span class="sync-needed">⚠</span>'}`;

            // Children (columns)
            const children = document.createElement('div');
            children.className = 'src-children';

            if (synced && src.columns && src.columns.length) {
                for (const col of src.columns) {
                    const colEl = document.createElement('div');
                    colEl.className = 'col-item';
                    colEl.title = `Double-click to insert ${src.name}.${col.name}`;
                    colEl.innerHTML = `
                        <span class="col-name">${esc(col.name)}</span>
                        <span class="col-dtype">(${esc(col.dtype)})</span>`;
                    colEl.addEventListener('dblclick', () => {
                        insertIntoEditor('`' + src.name + '`' + '.`' + col.name + '`');
                    });
                    children.appendChild(colEl);
                }

                // Toggle expand on header click
                header.addEventListener('click', () => {
                    const open = children.style.display !== 'none';
                    children.style.display = open ? 'none' : 'block';
                    header.querySelector('.src-toggle').textContent = open ? '▶' : '▼';
                });
            }

            wrapper.appendChild(header);
            wrapper.appendChild(children);
            elSourcesContainer.appendChild(wrapper);
        }
    }

    function insertIntoEditor(token) {
        const start = elSqlEditor.selectionStart;
        const end   = elSqlEditor.selectionEnd;
        const val   = elSqlEditor.value;
        elSqlEditor.value = val.slice(0, start) + token + val.slice(end);
        elSqlEditor.selectionStart = elSqlEditor.selectionEnd = start + token.length;
        elSqlEditor.focus();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CONNECTION BAR
    // ═════════════════════════════════════════════════════════════════════════
    function updateConnBar(host, database, user) {
        const parts = [];
        if (host)     { parts.push('Host: ' + host); }
        if (database) { parts.push('DB: ' + database); }
        if (user)     { parts.push('User: ' + user); }
        elConnLabel.textContent = parts.length ? parts.join('  ·  ') : 'Connection not configured';
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RESULTS
    // ═════════════════════════════════════════════════════════════════════════
    function showResultsIdle() {
        elRowCount.textContent = '';
        elResultsBody.innerHTML = `<div class="state">Run a query to see results.</div>`;
    }

    function showResultsLoading() {
        elRowCount.textContent = '';
        elResultsBody.innerHTML = `
            <div class="state"><div class="spinner"></div>Running…</div>`;
    }

    function showResultsError(msg) {
        elRowCount.textContent = '';
        elResultsBody.innerHTML = `<div class="error-banner">⚠ ${esc(msg)}</div>`;
    }

    function showResults(columns, dtypes, rows) {
        lastResults = { columns, dtypes, rows };
        elRowCount.textContent = `${rows.length} row${rows.length !== 1 ? 's' : ''}`;
        renderActiveTab();
    }

    function renderActiveTab() {
        if (!lastResults) { return; }
        const { columns, dtypes, rows } = lastResults;

        if (activeTab === 'raw') {
            elResultsBody.innerHTML = `<pre class="raw-pre">${esc(JSON.stringify({ columns, dtypes, rows }, null, 2))}</pre>`;
        } else {
            elResultsBody.innerHTML = '';
            elResultsBody.appendChild(buildTable(columns, rows));
        }
    }

    // ── Table builder (shared with source preview pattern) ────────────────────
    function buildTable(columns, rows) {
        const wrap = document.createElement('div');
        wrap.className = 'table-wrap';

        const table = document.createElement('table');

        // Head
        const thead = table.createTHead();
        const headRow = thead.insertRow();
        for (const col of columns) {
            const th = document.createElement('th');
            th.textContent = col;
            headRow.appendChild(th);
        }

        // Body
        const tbody = table.createTBody();
        for (const row of rows) {
            const tr = tbody.insertRow();
            // A null row means every cell in that row is null
            const cells = row ?? columns.map(() => null);
            for (const val of cells) {
                const td = tr.insertCell();
                if (val === null || val === undefined) {
                    td.className = 'null-cell';
                    td.textContent = '∅';
                } else {
                    const s = String(val);
                    td.textContent = s;
                    td.title = s;
                }
            }
        }

        wrap.appendChild(table);
        return wrap;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═════════════════════════════════════════════════════════════════════════
    function esc(s) {
        return String(s)
            .replace(/&/g,  '&amp;')
            .replace(/</g,  '&lt;')
            .replace(/>/g,  '&gt;')
            .replace(/"/g,  '&quot;');
    }

}());
