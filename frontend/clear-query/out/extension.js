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
exports.requireClient = exports.getClient = void 0;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const workspace_1 = require("./commands/workspace");
Object.defineProperty(exports, "getClient", { enumerable: true, get: function () { return workspace_1.getClient; } });
Object.defineProperty(exports, "requireClient", { enumerable: true, get: function () { return workspace_1.requireClient; } });
const workspaceTree_1 = require("./views/workspaceTree");
const sqlPanel_1 = require("./views/sqlPanel");
const source_1 = require("./commands/source");
const recipe_1 = require("./commands/recipe");
const sync_1 = require("./commands/sync");
const connection_1 = require("./commands/connection");
function activate(context) {
    // ── Status bar ────────────────────────────────────────────────────────
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.command = 'clearquery.openWorkspace';
    statusBar.text = '$(circle-slash) ClearQuery: no workspace';
    statusBar.tooltip = 'Click to open a ClearQuery workspace';
    statusBar.show();
    context.subscriptions.push(statusBar);
    // ── Workspace commands (open, new, restart) ───────────────────────────
    (0, workspace_1.initWorkspaceCommands)(context, statusBar);
    // ── Workspace tree (activity bar side panel) ──────────────────────────
    const treeProvider = new workspaceTree_1.WorkspaceTreeProvider();
    context.subscriptions.push(vscode.window.registerTreeDataProvider('clearquery.workspaceTree', treeProvider), treeProvider);
    // ── Source, recipe & sync commands ───────────────────────────────────
    (0, source_1.initSourceCommands)(context, treeProvider);
    (0, recipe_1.initRecipeCommands)(context, treeProvider);
    (0, sync_1.initSyncCommands)(context, treeProvider);
    // ── SQL panel command ─────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('clearquery.openSqlPanel', () => sqlPanel_1.SqlPanel.create(context.extensionUri)), vscode.commands.registerCommand('clearquery.exportSqlResult', () => sqlPanel_1.SqlPanel.requestExport()));
    // ── Restart backend when python path changes ──────────────────────────
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('clearquery.pythonPath')) {
            vscode.commands.executeCommand('clearquery.restartBackend');
        }
    }));
    // ── Expose onDidChangeClient for future tickets ───────────────────────
    context.subscriptions.push(workspace_1.onDidChangeClient);
    // ── Auto-detect workspace.json in the open folder ─────────────────────
    (0, workspace_1.autoDetectWorkspace)();
}
function deactivate() {
    (0, workspace_1.getClient)()?.dispose();
    (0, connection_1.clearPassword)();
}
//# sourceMappingURL=extension.js.map