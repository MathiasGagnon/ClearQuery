import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BackendClient } from '../backend/client';
import { WorkspacePayload } from '../backend/types';

// Fired whenever the active client changes so other parts of the extension
// can refresh their state.
export const onDidChangeClient = new vscode.EventEmitter<BackendClient | undefined>();

let _client: BackendClient | undefined;
let _statusBar: vscode.StatusBarItem | undefined;
let _extensionPath = '';
let _workspaceName = '';

// ─── Init (called from extension.ts activate) ────────────────────────────────

export function initWorkspaceCommands(
    context: vscode.ExtensionContext,
    statusBar: vscode.StatusBarItem,
): void {
    _extensionPath = context.extensionPath;
    _statusBar = statusBar;

    context.subscriptions.push(
        vscode.commands.registerCommand('clearquery.openWorkspace', openWorkspace),
        vscode.commands.registerCommand('clearquery.newWorkspace', newWorkspace),
        vscode.commands.registerCommand('clearquery.restartBackend', restartBackend),
    );
}

// ─── Getters ────────────────────────────────────────────────────────────────

export function getClient(): BackendClient | undefined {
    return _client;
}

export function getWorkspaceName(): string {
    return _workspaceName;
}

export function requireClient(): BackendClient {
    if (!_client) {
        throw new Error('No ClearQuery workspace open. Use "ClearQuery: Open Workspace" first.');
    }
    return _client;
}

// ─── Auto-detect on activate ─────────────────────────────────────────────────

export async function autoDetectWorkspace(): Promise<void> {
    const config = vscode.workspace.getConfiguration('clearquery');
    const savedPath: string = config.get('activeWorkspacePath') ?? '';

    // 1. Previously saved path
    if (savedPath && fs.existsSync(savedPath)) {
        await activateWorkspace(savedPath, /* silent */ true);
        return;
    }

    // 2. workspace.json at root of open folder
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) { return; }

    const candidate = path.join(folders[0].uri.fsPath, 'workspace.json');
    if (!fs.existsSync(candidate)) { return; }

    const choice = await vscode.window.showInformationMessage(
        `ClearQuery workspace found: ${path.basename(path.dirname(candidate))}. Open it?`,
        'Open',
        'Dismiss',
    );
    if (choice === 'Open') {
        await activateWorkspace(candidate);
    }
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function openWorkspace(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    const defaultUri = folders?.length
        ? folders[0].uri
        : undefined;

    const uris = await vscode.window.showOpenDialog({
        title: 'Open ClearQuery Workspace',
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri,
        filters: { 'ClearQuery Workspace': ['json'] },
    });

    if (!uris?.length) { return; }
    await activateWorkspace(uris[0].fsPath);
}

async function newWorkspace(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    const defaultUri = folders?.length ? folders[0].uri : undefined;

    const uri = await vscode.window.showSaveDialog({
        title: 'Create ClearQuery Workspace',
        defaultUri: defaultUri
            ? vscode.Uri.joinPath(defaultUri, 'workspace.json')
            : undefined,
        filters: { 'ClearQuery Workspace': ['json'] },
    });
    if (!uri) { return; }

    const name = await vscode.window.showInputBox({
        title: 'Workspace name',
        value: path.basename(path.dirname(uri.fsPath)),
        validateInput: v => v.trim() ? undefined : 'Name cannot be empty',
    });
    if (!name) { return; }

    await activateWorkspace(uri.fsPath, false, async (client) => {
        await client.send<WorkspacePayload>('create_workspace', {
            workspace_path: uri.fsPath,
            name: name.trim(),
        });
    });
}

async function restartBackend(): Promise<void> {
    const config = vscode.workspace.getConfiguration('clearquery');
    const savedPath: string = config.get('activeWorkspacePath') ?? '';
    if (!savedPath) {
        vscode.window.showErrorMessage('No workspace path configured. Open a workspace first.');
        return;
    }
    await activateWorkspace(savedPath);
}

// ─── Core: activate a workspace path ─────────────────────────────────────────

async function activateWorkspace(
    workspacePath: string,
    silent = false,
    beforeLoad?: (client: BackendClient) => Promise<void>,
): Promise<void> {
    // Dispose previous client
    _client?.dispose();
    _client = undefined;
    _workspaceName = '';
    onDidChangeClient.fire(undefined);
    updateStatusBar('starting', workspacePath);

    const config = vscode.workspace.getConfiguration('clearquery');
    const pythonPath: string = config.get('pythonPath') ?? 'python';

    const client = new BackendClient(workspacePath, pythonPath, _extensionPath);
    _client = client;

    // Mirror status changes to status bar
    client.onDidChangeStatus(status => {
        updateStatusBar(status, workspacePath);
    });

    try {
        // If a setup step is needed before load_workspace (e.g. create_workspace)
        if (beforeLoad) {
            await beforeLoad(client);
        }

        const wsPayload = await client.send<WorkspacePayload>('load_workspace', {
            workspace_path: workspacePath,
        });
        _workspaceName = wsPayload.name;

        // Persist the path — prefer workspace-scoped settings; fall back to
        // global when no folder/workspace is open (e.g. Extension Dev Host).
        try {
            await config.update(
                'activeWorkspacePath',
                workspacePath,
                vscode.ConfigurationTarget.Workspace,
            );
        } catch {
            await config.update(
                'activeWorkspacePath',
                workspacePath,
                vscode.ConfigurationTarget.Global,
            );
        }

        onDidChangeClient.fire(client);

        if (!silent) {
            const wsName = path.basename(path.dirname(workspacePath));
            vscode.window.showInformationMessage(`ClearQuery: opened workspace "${wsName}"`);
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ClearQuery: failed to open workspace — ${msg}`);
        updateStatusBar('error', workspacePath);
    }
}

// ─── Status bar helpers ───────────────────────────────────────────────────────

function updateStatusBar(
    status: 'starting' | 'ready' | 'error' | 'stopped',
    workspacePath?: string,
): void {
    if (!_statusBar) { return; }

    const wsName = workspacePath
        ? path.basename(path.dirname(workspacePath))
        : '';

    switch (status) {
        case 'starting':
            _statusBar.text = '$(gear~spin) ClearQuery: starting…';
            _statusBar.tooltip = `Starting backend for ${wsName}`;
            _statusBar.backgroundColor = undefined;
            break;
        case 'ready':
            _statusBar.text = `$(check) ClearQuery: ${wsName}`;
            _statusBar.tooltip = `Backend ready — ${workspacePath}\nClick to open a different workspace`;
            _statusBar.backgroundColor = undefined;
            break;
        case 'error':
            _statusBar.text = '$(error) ClearQuery: error';
            _statusBar.tooltip = 'Backend error — click to restart';
            _statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            break;
        case 'stopped':
            _statusBar.text = '$(circle-slash) ClearQuery: no workspace';
            _statusBar.tooltip = 'Click to open a ClearQuery workspace';
            _statusBar.backgroundColor = undefined;
            break;
    }
}
