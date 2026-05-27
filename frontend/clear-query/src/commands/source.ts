import * as vscode from 'vscode';
import * as path from 'path';
import { requireClient } from './workspace';
import { WorkspaceTreeProvider, SourceNode } from '../views/workspaceTree';
import { SourcePreviewPanel } from '../views/sourcePreview';

export function initSourceCommands(
    context: vscode.ExtensionContext,
    tree: WorkspaceTreeProvider,
): void {
    const extensionUri = context.extensionUri;
    context.subscriptions.push(
        vscode.commands.registerCommand('clearquery.addSource', () => addSource(tree)),
        vscode.commands.registerCommand('clearquery.removeSource', (node: SourceNode) =>
            removeSource(node, tree),
        ),
        vscode.commands.registerCommand('clearquery.previewSource', (node: SourceNode) =>
            previewSource(node, extensionUri),
        ),
    );
}

// ─── Add source ──────────────────────────────────────────────────────────────

async function addSource(tree: WorkspaceTreeProvider): Promise<void> {
    let client: ReturnType<typeof requireClient>;
    try { client = requireClient(); } catch (err: unknown) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        return;
    }

    const uris = await vscode.window.showOpenDialog({
        title: 'Add Data Source',
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'Data Files': ['csv', 'xlsx', 'xls'] },
    });
    if (!uris?.length) { return; }

    const filePath = uris[0].fsPath;
    const ext = path.extname(filePath).toLowerCase();
    const type = ext === '.csv' ? 'csv' : 'xlsx';
    const stem = path.basename(filePath, ext).replace(/[^a-zA-Z0-9_]/g, '_');

    const name = await vscode.window.showInputBox({
        title: 'Source name',
        value: stem,
        validateInput: v => v.trim() ? undefined : 'Name cannot be empty',
    });
    if (!name) { return; }

    // CSV-specific options: separator + encoding
    let csvSeparator: string | undefined;
    let csvEncoding: string | undefined;
    if (type === 'csv') {
        const sepChoice = await vscode.window.showQuickPick(
            [
                { label: 'Comma  ( , )', description: 'Standard CSV', value: ',' },
                { label: 'Semicolon  ( ; )', description: 'European / French CSV', value: ';' },
                { label: 'Tab  ( \\t )', description: 'TSV', value: '\t' },
                { label: 'Pipe  ( | )', description: 'Pipe-delimited', value: '|' },
            ],
            { title: 'CSV separator', placeHolder: 'Pick the column separator used in the file' },
        );
        if (!sepChoice) { return; }
        csvSeparator = sepChoice.value;

        const encChoice = await vscode.window.showQuickPick(
            [
                { label: 'UTF-8', description: 'Default — most files', value: 'utf-8' },
                { label: 'Latin-1 / ISO-8859-1', description: 'French, Spanish, Portuguese…', value: 'latin-1' },
                { label: 'Windows-1252 / CP1252', description: 'Windows Western European', value: 'cp1252' },
                { label: 'UTF-8 with BOM', description: 'Excel-exported UTF-8', value: 'utf-8-sig' },
            ],
            { title: 'CSV encoding', placeHolder: 'Pick the character encoding of the file' },
        );
        if (!encChoice) { return; }
        csvEncoding = encChoice.value;
    }

    try {
        const source: Record<string, unknown> = { name: name.trim(), type, path: filePath };
        if (csvSeparator !== undefined) { source['csv_separator'] = csvSeparator; }
        if (csvEncoding !== undefined) { source['csv_encoding'] = csvEncoding; }

        await client.send('add_source', {
            workspace_path: client.path,
            source,
        });
        await tree.refresh();
        vscode.window.showInformationMessage(
            `Source '${name.trim()}' added. Recipe type steps auto-inferred.`,
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ClearQuery: failed to add source — ${msg}`);
    }
}

// ─── Remove source ───────────────────────────────────────────────────────────

async function removeSource(node: SourceNode, tree: WorkspaceTreeProvider): Promise<void> {
    let client: ReturnType<typeof requireClient>;
    try { client = requireClient(); } catch (err: unknown) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        return;
    }

    const choice = await vscode.window.showWarningMessage(
        `Remove source "${node.info.name}"? This cannot be undone.`,
        { modal: true },
        'Remove',
    );
    if (choice !== 'Remove') { return; }

    try {
        await client.send('remove_source', {
            workspace_path: client.path,
            source_name: node.info.name,
        });
        await tree.refresh();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ClearQuery: failed to remove source — ${msg}`);
    }
}

// ─── Preview source ───────────────────────────────────────────────────────────

function previewSource(node: SourceNode, extensionUri: vscode.Uri): void {
    let client: ReturnType<typeof requireClient>;
    try { client = requireClient(); } catch (err: unknown) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        return;
    }
    SourcePreviewPanel.create(extensionUri, client, node.info.name);
}
