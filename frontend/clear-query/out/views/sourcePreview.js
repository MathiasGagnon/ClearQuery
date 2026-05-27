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
exports.SourcePreviewPanel = void 0;
const vscode = __importStar(require("vscode"));
class SourcePreviewPanel {
    // One panel per source name — reuse if already open
    static _panels = new Map();
    _panel;
    _sourceName;
    _disposables = [];
    // ── Public factory ────────────────────────────────────────────────────────
    static create(extensionUri, client, sourceName) {
        const existing = SourcePreviewPanel._panels.get(sourceName);
        if (existing) {
            existing._panel.reveal(vscode.ViewColumn.Beside);
            void existing._load(client);
            return;
        }
        new SourcePreviewPanel(extensionUri, client, sourceName);
    }
    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(extensionUri, client, sourceName) {
        this._sourceName = sourceName;
        this._panel = vscode.window.createWebviewPanel('clearqueryPreview', `Preview: ${sourceName}`, vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webviews')],
        });
        this._panel.webview.html = this._buildHtml(extensionUri);
        // Messages from the webview (e.g. refresh button)
        this._panel.webview.onDidReceiveMessage(msg => { if (msg.type === 'refresh') {
            void this._load(client);
        } }, undefined, this._disposables);
        // Cleanup when the panel is closed
        this._panel.onDidDispose(() => this._dispose(), undefined, this._disposables);
        SourcePreviewPanel._panels.set(sourceName, this);
        void this._load(client);
    }
    // ── Data loading ──────────────────────────────────────────────────────────
    async _load(client) {
        this._panel.webview.postMessage({ type: 'loading' });
        try {
            const data = await client.send('get_preview', {
                workspace_path: client.path,
                source_name: this._sourceName,
                limit: 500,
            });
            this._panel.webview.postMessage({ type: 'data', ...data });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._panel.webview.postMessage({ type: 'error', message: msg });
        }
    }
    // ── HTML shell ────────────────────────────────────────────────────────────
    _buildHtml(extensionUri) {
        const scriptUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webviews', 'preview', 'main.js'));
        const csp = this._panel.webview.cspSource;
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; script-src ${csp}; style-src 'unsafe-inline';">
    <title>Preview: ${this._sourceName}</title>
</head>
<body>
    <div id="root"></div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
    // ── Dispose ───────────────────────────────────────────────────────────────
    _dispose() {
        SourcePreviewPanel._panels.delete(this._sourceName);
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}
exports.SourcePreviewPanel = SourcePreviewPanel;
//# sourceMappingURL=sourcePreview.js.map