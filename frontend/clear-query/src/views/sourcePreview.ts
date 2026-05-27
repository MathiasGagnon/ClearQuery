import * as vscode from 'vscode';
import { BackendClient } from '../backend/client';
import { PreviewPayload } from '../backend/types';

export class SourcePreviewPanel {
    // One panel per source name — reuse if already open
    private static readonly _panels = new Map<string, SourcePreviewPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _sourceName: string;
    private _disposables: vscode.Disposable[] = [];

    // ── Public factory ────────────────────────────────────────────────────────

    static create(
        extensionUri: vscode.Uri,
        client: BackendClient,
        sourceName: string,
    ): void {
        const existing = SourcePreviewPanel._panels.get(sourceName);
        if (existing) {
            existing._panel.reveal(vscode.ViewColumn.Beside);
            void existing._load(client);
            return;
        }
        new SourcePreviewPanel(extensionUri, client, sourceName);
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    private constructor(
        extensionUri: vscode.Uri,
        client: BackendClient,
        sourceName: string,
    ) {
        this._sourceName = sourceName;

        this._panel = vscode.window.createWebviewPanel(
            'clearqueryPreview',
            `Preview: ${sourceName}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webviews')],
            },
        );

        this._panel.webview.html = this._buildHtml(extensionUri);

        // Messages from the webview (e.g. refresh button)
        this._panel.webview.onDidReceiveMessage(
            msg => { if (msg.type === 'refresh') { void this._load(client); } },
            undefined,
            this._disposables,
        );

        // Cleanup when the panel is closed
        this._panel.onDidDispose(() => this._dispose(), undefined, this._disposables);

        SourcePreviewPanel._panels.set(sourceName, this);

        void this._load(client);
    }

    // ── Data loading ──────────────────────────────────────────────────────────

    private async _load(client: BackendClient): Promise<void> {
        this._panel.webview.postMessage({ type: 'loading' });

        try {
            const data = await client.send<PreviewPayload>('get_preview', {
                workspace_path: client.path,
                source_name: this._sourceName,
                limit: 500,
            });
            this._panel.webview.postMessage({ type: 'data', ...data });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this._panel.webview.postMessage({ type: 'error', message: msg });
        }
    }

    // ── HTML shell ────────────────────────────────────────────────────────────

    private _buildHtml(extensionUri: vscode.Uri): string {
        const scriptUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'webviews', 'preview', 'main.js'),
        );
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

    private _dispose(): void {
        SourcePreviewPanel._panels.delete(this._sourceName);
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}
