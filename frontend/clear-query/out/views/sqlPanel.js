"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqlPanel = void 0;
const vscode = __importStar(require("vscode"));
const workspace_1 = require("../commands/workspace");
const connection_1 = require("../commands/connection");
const export_1 = require("../commands/export");
class SqlPanel {
    static _instance;
    // ── Public factory ────────────────────────────────────────────────────────
    static create(extensionUri) {
        if (SqlPanel._instance) {
            SqlPanel._instance._panel.reveal(vscode.ViewColumn.One);
            return;
        }
        new SqlPanel(extensionUri);
    }
    static requestExport() {
        SqlPanel._instance?._panel.webview.postMessage({ type: 'requestExport' });
    }
    // ── Instance ──────────────────────────────────────────────────────────────
    _panel;
    _disposables = [];
    constructor(extensionUri) {
        this._panel = vscode.window.createWebviewPanel('clearquerySql', `SQL — ${(0, workspace_1.getWorkspaceName)() || 'ClearQuery'}`, vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webviews')],
        });
        this._panel.webview.html = this._buildHtml(extensionUri);
        // Messages from webview
        this._panel.webview.onDidReceiveMessage(msg => void this._handleMessage(msg), undefined, this._disposables);
        // Keep title + sources in sync when workspace changes
        this._disposables.push(workspace_1.onDidChangeClient.event(() => {
            this._panel.title = `SQL — ${(0, workspace_1.getWorkspaceName)() || 'ClearQuery'}`;
            this._sendConfig();
            void this._sendSources();
        }));
        this._panel.onDidDispose(() => this._dispose(), undefined, this._disposables);
        SqlPanel._instance = this;
    }
    // ── Message handling ──────────────────────────────────────────────────────
    async _handleMessage(msg) {
        switch (msg.type) {
            case 'ready':
                this._sendConfig();
                await this._sendSources();
                break;
            case 'runQuery':
                await this._runQuery(String(msg.query ?? ''));
                break;
            case 'refreshSources':
                await this._sendSources();
                break;
            case 'syncSources':
                vscode.commands.executeCommand('clearquery.syncSources');
                break;
            case 'openSettings':
                vscode.commands.executeCommand('workbench.action.openSettings', 'clearquery.connection');
                break;
            case 'export': {
                const client = (0, workspace_1.getClient)();
                if (client) {
                    void (0, export_1.exportSqlResult)(client, String(msg.query ?? ''));
                }
                break;
            }
        }
    }
    // ── Config ────────────────────────────────────────────────────────────────
    _sendConfig() {
        const cfg = vscode.workspace.getConfiguration('clearquery');
        this._panel.webview.postMessage({
            type: 'config',
            host: cfg.get('connection.host') ?? 'localhost',
            database: cfg.get('connection.database') ?? '',
            user: cfg.get('connection.user') ?? '',
        });
    }
    // ── Sources ───────────────────────────────────────────────────────────────
    async _sendSources() {
        const client = (0, workspace_1.getClient)();
        if (!client) {
            this._panel.webview.postMessage({ type: 'sources', sources: [] });
            return;
        }
        try {
            const schema = await client.send('get_sources_schema', {
                workspace_path: client.path,
            });
            this._panel.webview.postMessage({ type: 'sources', sources: schema.sources });
        }
        catch {
            // Sources pane is informational; don't block the user with an error
        }
    }
    // ── Query execution ───────────────────────────────────────────────────────
    async _runQuery(query) {
        if (!query.trim()) {
            return;
        }
        const client = (0, workspace_1.getClient)();
        if (!client) {
            this._panel.webview.postMessage({ type: 'error', message: 'No workspace open.' });
            return;
        }
        if (!(0, connection_1.isMariaDbConfigured)()) {
            this._panel.webview.postMessage({
                type: 'error',
                message: 'No MariaDB connection configured. Open Settings → ClearQuery → Connection.',
            });
            return;
        }
        const cfg = vscode.workspace.getConfiguration('clearquery');
        const limit = cfg.get('sql.defaultLimit') ?? 500;
        this._panel.webview.postMessage({ type: 'loading' });
        try {
            const result = await (0, connection_1.withConnection)(conn => client.send('sql_preview', { connection: conn, query, limit }));
            if (result === undefined) {
                // User cancelled password prompt — go back to idle state
                this._panel.webview.postMessage({ type: 'idle' });
                return;
            }
            this._panel.webview.postMessage({ type: 'results', ...result });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._panel.webview.postMessage({ type: 'error', message: msg });
        }
    }
    // ── HTML shell ────────────────────────────────────────────────────────────
    _buildHtml(extensionUri) {
        const scriptUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webviews', 'sql', 'main.js'));
        const csp = this._panel.webview.cspSource;
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; script-src ${csp}; style-src 'unsafe-inline';">
    <title>SQL</title>
</head>
<body>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
    // ── Dispose ───────────────────────────────────────────────────────────────
    _dispose() {
        SqlPanel._instance = undefined;
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}
exports.SqlPanel = SqlPanel;
//# sourceMappingURL=sqlPanel.js.map