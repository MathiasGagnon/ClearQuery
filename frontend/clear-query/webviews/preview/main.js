// @ts-nocheck
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();
    const root = document.getElementById('root');

    // ── Styles ────────────────────────────────────────────────────────────────

    const style = document.createElement('style');
    style.textContent = `
        * { box-sizing: border-box; }

        body {
            margin: 0;
            padding: 0;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family, sans-serif);
            font-size: var(--vscode-font-size, 13px);
        }

        /* ── Toolbar ── */
        .toolbar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 6px 12px;
            background: var(--vscode-sideBar-background, var(--vscode-editor-background));
            border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
            position: sticky;
            top: 0;
            z-index: 10;
        }

        .toolbar button {
            display: flex;
            align-items: center;
            gap: 4px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 3px 10px;
            cursor: pointer;
            border-radius: 2px;
            font-size: inherit;
        }

        .toolbar button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .row-count {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
        }

        /* ── Table wrapper ── */
        .table-wrap {
            overflow-x: auto;
        }

        table {
            border-collapse: collapse;
            min-width: 100%;
        }

        /* ── Header ── */
        thead {
            position: sticky;
            top: 33px;   /* below toolbar */
            z-index: 5;
        }

        th {
            text-align: left;
            padding: 5px 12px;
            border-bottom: 2px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
            white-space: nowrap;
            background: var(--vscode-sideBar-background, var(--vscode-editor-background));
            font-weight: 600;
            user-select: none;
        }

        .dtype {
            display: block;
            color: var(--vscode-descriptionForeground);
            font-size: 0.82em;
            font-weight: 400;
            margin-top: 1px;
        }

        /* ── Body ── */
        td {
            padding: 3px 12px;
            border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.08));
            white-space: nowrap;
            max-width: 320px;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        tbody tr:nth-child(odd) td {
            background: var(--vscode-editor-background);
        }

        tbody tr:nth-child(even) td {
            background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.04));
        }

        tbody tr:hover td {
            background: var(--vscode-list-hoverBackground);
        }

        td.null-cell {
            color: var(--vscode-disabledForeground, rgba(128,128,128,0.5));
            font-style: italic;
        }

        /* ── States ── */
        .state {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
            color: var(--vscode-foreground);
            font-size: 1em;
        }

        .state.error {
            color: var(--vscode-errorForeground, #f48771);
        }

        .spinner {
            width: 18px;
            height: 18px;
            border: 2px solid var(--vscode-foreground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.7s linear infinite;
            margin-right: 8px;
        }

        @keyframes spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);

    // ── Message handler ───────────────────────────────────────────────────────

    window.addEventListener('message', event => {
        const msg = event.data;
        switch (msg.type) {
            case 'loading': showLoading(); break;
            case 'data':    showTable(msg.columns, msg.dtypes, msg.rows); break;
            case 'error':   showError(msg.message); break;
        }
    });

    // ── Renderers ─────────────────────────────────────────────────────────────

    function showLoading() {
        root.innerHTML = `
            <div class="state">
                <div class="spinner"></div>
                Loading…
            </div>`;
    }

    function showError(msg) {
        root.innerHTML = `
            <div class="state error">⚠&nbsp; ${esc(msg)}</div>`;
    }

    function showTable(columns, dtypes, rows) {
        // Header cells
        const thCells = columns.map(col => {
            const dt = dtypes[col] || '';
            return `<th>${esc(col)}<span class="dtype">${esc(dt)}</span></th>`;
        }).join('');

        // Body rows
        const tbodyRows = rows.map(row => {
            // A null row means every cell in that row is null
            const cells = row ?? columns.map(() => null);
            const tds = cells.map(val => {
                if (val === null || val === undefined) {
                    return `<td class="null-cell" title="null">∅</td>`;
                }
                const s = String(val);
                return `<td title="${esc(s)}">${esc(s)}</td>`;
            }).join('');
            return `<tr>${tds}</tr>`;
        }).join('');

        root.innerHTML = `
            <div class="toolbar">
                <button id="btn-refresh">↻ Refresh</button>
                <span class="row-count">Showing ${rows.length} row${rows.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="table-wrap">
                <table>
                    <thead><tr>${thCells}</tr></thead>
                    <tbody>${tbodyRows}</tbody>
                </table>
            </div>`;

        document.getElementById('btn-refresh').addEventListener('click', () => {
            vscode.postMessage({ type: 'refresh' });
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function esc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

}());
