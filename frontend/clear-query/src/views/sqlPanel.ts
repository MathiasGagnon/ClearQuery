import * as vscode from 'vscode';
import { getClient, getWorkspaceName, onDidChangeClient } from '../commands/workspace';
import { isMariaDbConfigured, withConnection } from '../commands/connection';
import { SourcesSchemaPayload, PreviewPayload } from '../backend/types';
import { exportSqlResult } from '../commands/export';

export class SqlPanel {
    private static _instance: SqlPanel | undefined;

    // ── Public factory ────────────────────────────────────────────────────────

    static create(extensionUri: vscode.Uri): void {
        if (SqlPanel._instance) {
            SqlPanel._instance._panel.reveal(vscode.ViewColumn.One);
            return;
        }
        new SqlPanel(extensionUri);
    }

    static requestExport(): void {
        SqlPanel._instance?._panel.webview.postMessage({ type: 'requestExport' });
    }

    // ── Instance ──────────────────────────────────────────────────────────────

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(extensionUri: vscode.Uri) {
        this._panel = vscode.window.createWebviewPanel(
            'clearquerySql',
            `SQL — ${getWorkspaceName() || 'ClearQuery'}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webviews')],
            },
        );

        this._panel.webview.html = this._buildHtml(extensionUri);

        // Messages from webview
        this._panel.webview.onDidReceiveMessage(
            msg => void this._handleMessage(msg),
            undefined,
            this._disposables,
        );

        // Keep title + sources in sync when workspace changes
        this._disposables.push(
            onDidChangeClient.event(() => {
                this._panel.title = `SQL — ${getWorkspaceName() || 'ClearQuery'}`;
                this._sendConfig();
                void this._sendSources();
            }),
        );

        this._panel.onDidDispose(() => this._dispose(), undefined, this._disposables);
        SqlPanel._instance = this;
    }

    // ── Message handling ──────────────────────────────────────────────────────

    private async _handleMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
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
                vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'clearquery.connection',
                );
                break;

            case 'export': {
                const client = getClient();
                if (client) {
                    void exportSqlResult(client, String(msg.query ?? ''));
                }
                break;
            }

            case 'cancelQuery': {
                const client = getClient();
                if (client) {
                    client.cancelQuery();
                }
                // Webview already shows idle — just confirm with an idle message
                this._panel.webview.postMessage({ type: 'idle' });
                break;
            }
        }
    }

    // ── Config ────────────────────────────────────────────────────────────────

    private _sendConfig(): void {
        const cfg = vscode.workspace.getConfiguration('clearquery');
        this._panel.webview.postMessage({
            type: 'config',
            host:     cfg.get<string>('connection.host')     ?? 'localhost',
            database: cfg.get<string>('connection.database') ?? '',
            user:     cfg.get<string>('connection.user')     ?? '',
        });
    }

    // ── Sources ───────────────────────────────────────────────────────────────

    private async _sendSources(): Promise<void> {
        const client = getClient();
        if (!client) {
            this._panel.webview.postMessage({ type: 'sources', sources: [] });
            return;
        }
        try {
            const schema = await client.send<SourcesSchemaPayload>('get_sources_schema', {
                workspace_path: client.path,
            });
            this._panel.webview.postMessage({ type: 'sources', sources: schema.sources });
        } catch {
            // Sources pane is informational; don't block the user with an error
        }
    }

    // ── Query execution ───────────────────────────────────────────────────────

    private async _runQuery(query: string): Promise<void> {
        if (!query.trim()) { return; }

        const client = getClient();
        if (!client) {
            this._panel.webview.postMessage({ type: 'error', message: 'No workspace open.' });
            return;
        }

        if (!isMariaDbConfigured()) {
            this._panel.webview.postMessage({
                type: 'error',
                message: 'No MariaDB connection configured. Open Settings → ClearQuery → Connection.',
            });
            return;
        }

        const cfg = vscode.workspace.getConfiguration('clearquery');
        const limit = cfg.get<number>('sql.defaultLimit') ?? 500;

        this._panel.webview.postMessage({ type: 'loading' });

        try {
            const result = await withConnection(conn =>
                client.send<PreviewPayload>('sql_preview', { connection: conn, query, limit }),
            );
            if (result === undefined) {
                // User cancelled password prompt — go back to idle state
                this._panel.webview.postMessage({ type: 'idle' });
                return;
            }
            this._panel.webview.postMessage({ type: 'results', ...result });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this._panel.webview.postMessage({ type: 'error', message: msg });
        }
    }

    // ── HTML shell ────────────────────────────────────────────────────────────

    private _buildHtml(extensionUri: vscode.Uri): string {
        const scriptUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'webviews', 'sql', 'main.js'),
        );
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

    private _dispose(): void {
        SqlPanel._instance = undefined;
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}
