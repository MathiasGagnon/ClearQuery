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
exports.initSourceCommands = initSourceCommands;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const workspace_1 = require("./workspace");
const sourcePreview_1 = require("../views/sourcePreview");
function initSourceCommands(context, tree) {
    const extensionUri = context.extensionUri;
    context.subscriptions.push(vscode.commands.registerCommand('clearquery.addSource', () => addSource(tree)), vscode.commands.registerCommand('clearquery.removeSource', (node) => removeSource(node, tree)), vscode.commands.registerCommand('clearquery.previewSource', (node) => previewSource(node, extensionUri)));
}
// ─── Add source ──────────────────────────────────────────────────────────────
async function addSource(tree) {
    let client;
    try {
        client = (0, workspace_1.requireClient)();
    }
    catch (err) {
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
    if (!uris?.length) {
        return;
    }
    const filePath = uris[0].fsPath;
    const ext = path.extname(filePath).toLowerCase();
    const type = ext === '.csv' ? 'csv' : 'xlsx';
    const stem = path.basename(filePath, ext).replace(/[^a-zA-Z0-9_]/g, '_');
    const name = await vscode.window.showInputBox({
        title: 'Source name',
        value: stem,
        validateInput: v => v.trim() ? undefined : 'Name cannot be empty',
    });
    if (!name) {
        return;
    }
    // CSV-specific options: separator + encoding
    let csvSeparator;
    let csvEncoding;
    if (type === 'csv') {
        const sepChoice = await vscode.window.showQuickPick([
            { label: 'Comma  ( , )', description: 'Standard CSV', value: ',' },
            { label: 'Semicolon  ( ; )', description: 'European / French CSV', value: ';' },
            { label: 'Tab  ( \\t )', description: 'TSV', value: '\t' },
            { label: 'Pipe  ( | )', description: 'Pipe-delimited', value: '|' },
        ], { title: 'CSV separator', placeHolder: 'Pick the column separator used in the file' });
        if (!sepChoice) {
            return;
        }
        csvSeparator = sepChoice.value;
        const encChoice = await vscode.window.showQuickPick([
            { label: 'UTF-8', description: 'Default — most files', value: 'utf-8' },
            { label: 'Latin-1 / ISO-8859-1', description: 'French, Spanish, Portuguese…', value: 'latin-1' },
            { label: 'Windows-1252 / CP1252', description: 'Windows Western European', value: 'cp1252' },
            { label: 'UTF-8 with BOM', description: 'Excel-exported UTF-8', value: 'utf-8-sig' },
        ], { title: 'CSV encoding', placeHolder: 'Pick the character encoding of the file' });
        if (!encChoice) {
            return;
        }
        csvEncoding = encChoice.value;
    }
    try {
        const source = { name: name.trim(), type, path: filePath };
        if (csvSeparator !== undefined) {
            source['csv_separator'] = csvSeparator;
        }
        if (csvEncoding !== undefined) {
            source['csv_encoding'] = csvEncoding;
        }
        await client.send('add_source', {
            workspace_path: client.path,
            source,
        });
        await tree.refresh();
        vscode.window.showInformationMessage(`Source '${name.trim()}' added. Recipe type steps auto-inferred.`);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ClearQuery: failed to add source — ${msg}`);
    }
}
// ─── Remove source ───────────────────────────────────────────────────────────
async function removeSource(node, tree) {
    let client;
    try {
        client = (0, workspace_1.requireClient)();
    }
    catch (err) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        return;
    }
    const choice = await vscode.window.showWarningMessage(`Remove source "${node.info.name}"? This cannot be undone.`, { modal: true }, 'Remove');
    if (choice !== 'Remove') {
        return;
    }
    try {
        await client.send('remove_source', {
            workspace_path: client.path,
            source_name: node.info.name,
        });
        await tree.refresh();
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ClearQuery: failed to remove source — ${msg}`);
    }
}
// ─── Preview source ───────────────────────────────────────────────────────────
function previewSource(node, extensionUri) {
    let client;
    try {
        client = (0, workspace_1.requireClient)();
    }
    catch (err) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        return;
    }
    sourcePreview_1.SourcePreviewPanel.create(extensionUri, client, node.info.name);
}
//# sourceMappingURL=source.js.map