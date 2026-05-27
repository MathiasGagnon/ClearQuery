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
    const encodingChoice = await vscode.window.showQuickPick(
        [
            {
                label: 'utf-8-sig',
                description: 'UTF-8 with BOM — opens correctly in Excel on Windows (recommended)',
            },
            {
                label: 'utf-8',
                description: 'UTF-8 without BOM — best for scripts, Linux, macOS',
            },
            {
                label: 'latin-1',
                description: 'Latin-1 / ISO-8859-1 — legacy Western European',
            },
            {
                label: 'cp1252',
                description: 'Windows-1252 — legacy Windows Western European',
            },
        ],
        {
            title: 'Export — CSV encoding',
            placeHolder: 'Pick an encoding',
        },
    );
    if (encodingChoice === undefined) { return; }   // Escape → abort
    const encoding = encodingChoice.label;

    const separatorChoice = await vscode.window.showQuickPick(
        [
            { label: ';', description: 'Semicolon (default in French/European Excel)' },
            { label: ',', description: 'Comma (default in English Excel)' },
            { label: '\\t', description: 'Tab' },
            { label: '|', description: 'Pipe' },
        ],
        {
            title: 'Export — CSV separator',
            placeHolder: 'Pick a separator',
        },
    );
    if (separatorChoice === undefined) { return; }   // Escape → abort
    const separator = separatorChoice.label === '\\t' ? '\t' : separatorChoice.label;

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
