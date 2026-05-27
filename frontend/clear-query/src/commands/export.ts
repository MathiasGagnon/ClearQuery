import * as vscode from 'vscode';
import { isMariaDbConfigured, withConnection } from './connection';
import { BackendClient } from '../backend/client';
import { ExportPayload } from '../backend/types';

export async function exportSqlResult(
    client: BackendClient,
    query: string,
): Promise<void> {
    if (!query.trim()) {
        vscode.window.showErrorMessage(
            'ClearQuery: Nothing to export — write a SQL query first.',
        );
        return;
    }

    if (!isMariaDbConfigured()) {
        vscode.window.showErrorMessage(
            'ClearQuery: No MariaDB connection configured. Open Settings → ClearQuery → Connection.',
        );
        return;
    }

    // ── Options dialog ────────────────────────────────────────────────────────
    const encoding = await vscode.window.showInputBox({
        title: 'Export — CSV encoding',
        value: 'utf-8',
        placeHolder: 'e.g. utf-8 · latin-1 · cp1252',
        validateInput: v => v.trim() ? undefined : 'Encoding cannot be empty',
    });
    if (encoding === undefined) { return; }   // Escape → abort

    const separator = await vscode.window.showInputBox({
        title: 'Export — CSV separator',
        value: ';',
        placeHolder: 'e.g.  ;  or  ,',
        validateInput: v => v ? undefined : 'Separator cannot be empty',
    });
    if (separator === undefined) { return; }   // Escape → abort

    // ── Export with progress ──────────────────────────────────────────────────
    let result: ExportPayload | undefined;
    let exportError: string | undefined;
    let cancelled = false;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'ClearQuery: Exporting…',
            cancellable: false,
        },
        async () => {
            try {
                const r = await withConnection(conn =>
                    client.send<ExportPayload>('export_sql_result', {
                        workspace_path: client.path,
                        query,
                        connection: conn,
                        encoding: encoding.trim(),
                        separator,
                    }),
                );
                if (r === undefined) {
                    cancelled = true;
                } else {
                    result = r;
                }
            } catch (err: unknown) {
                exportError = err instanceof Error ? err.message : String(err);
            }
        },
    );

    if (cancelled) { return; }

    if (exportError) {
        vscode.window.showErrorMessage(
            `ClearQuery: Export failed — ${exportError}`,
            { modal: true },
        );
        return;
    }

    if (result) {
        const n = result.rows;
        const choice = await vscode.window.showInformationMessage(
            `ClearQuery: Exported ${n} row${n !== 1 ? 's' : ''} → ${result.export_path}`,
            'Open folder',
        );
        if (choice === 'Open folder') {
            vscode.commands.executeCommand(
                'revealFileInOS',
                vscode.Uri.file(result.export_path),
            );
        }
    }
}
