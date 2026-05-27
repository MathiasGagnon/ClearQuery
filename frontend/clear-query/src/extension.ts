import * as vscode from 'vscode';
import {
    initWorkspaceCommands,
    autoDetectWorkspace,
    getClient,
    requireClient,
    onDidChangeClient,
} from './commands/workspace';
import { WorkspaceTreeProvider } from './views/workspaceTree';
import { SqlPanel } from './views/sqlPanel';
import { initSourceCommands } from './commands/source';
import { initRecipeCommands } from './commands/recipe';
import { initSyncCommands } from './commands/sync';
import { clearPassword } from './commands/connection';

export { getClient, requireClient };

export function activate(context: vscode.ExtensionContext): void {
    // ── Status bar ────────────────────────────────────────────────────────
    const statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100,
    );
    statusBar.command = 'clearquery.openWorkspace';
    statusBar.text = '$(circle-slash) ClearQuery: no workspace';
    statusBar.tooltip = 'Click to open a ClearQuery workspace';
    statusBar.show();
    context.subscriptions.push(statusBar);

    // ── Workspace commands (open, new, restart) ───────────────────────────
    initWorkspaceCommands(context, statusBar);

    // ── Workspace tree (activity bar side panel) ──────────────────────────
    const treeProvider = new WorkspaceTreeProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('clearquery.workspaceTree', treeProvider),
        treeProvider,
    );

    // ── Source, recipe & sync commands ───────────────────────────────────
    initSourceCommands(context, treeProvider);
    initRecipeCommands(context, treeProvider);
    initSyncCommands(context, treeProvider);

    // ── SQL panel command ─────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('clearquery.openSqlPanel', () =>
            SqlPanel.create(context.extensionUri),
        ),
        vscode.commands.registerCommand('clearquery.exportSqlResult', () =>
            SqlPanel.requestExport(),
        ),
    );

    // ── Restart backend when python path changes ──────────────────────────
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('clearquery.pythonPath')) {
                vscode.commands.executeCommand('clearquery.restartBackend');
            }
        }),
    );

    // ── Expose onDidChangeClient for future tickets ───────────────────────
    context.subscriptions.push(onDidChangeClient);

    // ── Auto-detect workspace.json in the open folder ─────────────────────
    autoDetectWorkspace();
}

export function deactivate(): void {
    getClient()?.dispose();
    clearPassword();
}
