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
exports.onDidChangeClient = void 0;
exports.initWorkspaceCommands = initWorkspaceCommands;
exports.getClient = getClient;
exports.getWorkspaceName = getWorkspaceName;
exports.requireClient = requireClient;
exports.autoDetectWorkspace = autoDetectWorkspace;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const client_1 = require("../backend/client");
// Fired whenever the active client changes so other parts of the extension
// can refresh their state.
exports.onDidChangeClient = new vscode.EventEmitter();
let _client;
let _statusBar;
let _extensionPath = '';
let _workspaceName = '';
// ─── Init (called from extension.ts activate) ────────────────────────────────
function initWorkspaceCommands(context, statusBar) {
    _extensionPath = context.extensionPath;
    _statusBar = statusBar;
    context.subscriptions.push(vscode.commands.registerCommand('clearquery.openWorkspace', openWorkspace), vscode.commands.registerCommand('clearquery.newWorkspace', newWorkspace), vscode.commands.registerCommand('clearquery.restartBackend', restartBackend));
}
// ─── Getters ────────────────────────────────────────────────────────────────
function getClient() {
    return _client;
}
function getWorkspaceName() {
    return _workspaceName;
}
function requireClient() {
    if (!_client) {
        throw new Error('No ClearQuery workspace open. Use "ClearQuery: Open Workspace" first.');
    }
    return _client;
}
// ─── Auto-detect on activate ─────────────────────────────────────────────────
async function autoDetectWorkspace() {
    const config = vscode.workspace.getConfiguration('clearquery');
    const savedPath = config.get('activeWorkspacePath') ?? '';
    // 1. Previously saved path
    if (savedPath && fs.existsSync(savedPath)) {
        await activateWorkspace(savedPath, /* silent */ true);
        return;
    }
    // 2. workspace.json at root of open folder
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        return;
    }
    const candidate = path.join(folders[0].uri.fsPath, 'workspace.json');
    if (!fs.existsSync(candidate)) {
        return;
    }
    const choice = await vscode.window.showInformationMessage(`ClearQuery workspace found: ${path.basename(path.dirname(candidate))}. Open it?`, 'Open', 'Dismiss');
    if (choice === 'Open') {
        await activateWorkspace(candidate);
    }
}
// ─── Commands ────────────────────────────────────────────────────────────────
async function openWorkspace() {
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
    if (!uris?.length) {
        return;
    }
    await activateWorkspace(uris[0].fsPath);
}
async function newWorkspace() {
    const folders = vscode.workspace.workspaceFolders;
    const defaultUri = folders?.length ? folders[0].uri : undefined;
    const uri = await vscode.window.showSaveDialog({
        title: 'Create ClearQuery Workspace',
        defaultUri: defaultUri
            ? vscode.Uri.joinPath(defaultUri, 'workspace.json')
            : undefined,
        filters: { 'ClearQuery Workspace': ['json'] },
    });
    if (!uri) {
        return;
    }
    const name = await vscode.window.showInputBox({
        title: 'Workspace name',
        value: path.basename(path.dirname(uri.fsPath)),
        validateInput: v => v.trim() ? undefined : 'Name cannot be empty',
    });
    if (!name) {
        return;
    }
    await activateWorkspace(uri.fsPath, false, async (client) => {
        await client.send('create_workspace', {
            workspace_path: uri.fsPath,
            name: name.trim(),
        });
    });
}
async function restartBackend() {
    const config = vscode.workspace.getConfiguration('clearquery');
    const savedPath = config.get('activeWorkspacePath') ?? '';
    if (!savedPath) {
        vscode.window.showErrorMessage('No workspace path configured. Open a workspace first.');
        return;
    }
    await activateWorkspace(savedPath);
}
// ─── Core: activate a workspace path ─────────────────────────────────────────
async function activateWorkspace(workspacePath, silent = false, beforeLoad) {
    // Dispose previous client
    _client?.dispose();
    _client = undefined;
    _workspaceName = '';
    exports.onDidChangeClient.fire(undefined);
    updateStatusBar('starting', workspacePath);
    const config = vscode.workspace.getConfiguration('clearquery');
    const pythonPath = config.get('pythonPath') ?? 'python';
    const client = new client_1.BackendClient(workspacePath, pythonPath, _extensionPath);
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
        const wsPayload = await client.send('load_workspace', {
            workspace_path: workspacePath,
        });
        _workspaceName = wsPayload.name;
        // Persist the path — prefer workspace-scoped settings; fall back to
        // global when no folder/workspace is open (e.g. Extension Dev Host).
        try {
            await config.update('activeWorkspacePath', workspacePath, vscode.ConfigurationTarget.Workspace);
        }
        catch {
            await config.update('activeWorkspacePath', workspacePath, vscode.ConfigurationTarget.Global);
        }
        exports.onDidChangeClient.fire(client);
        if (!silent) {
            const wsName = path.basename(path.dirname(workspacePath));
            vscode.window.showInformationMessage(`ClearQuery: opened workspace "${wsName}"`);
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ClearQuery: failed to open workspace — ${msg}`);
        updateStatusBar('error', workspacePath);
    }
}
// ─── Status bar helpers ───────────────────────────────────────────────────────
function updateStatusBar(status, workspacePath) {
    if (!_statusBar) {
        return;
    }
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
//# sourceMappingURL=workspace.js.map