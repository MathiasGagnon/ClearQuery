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
exports.exportSqlResult = exportSqlResult;
const vscode = __importStar(require("vscode"));
const connection_1 = require("./connection");
async function exportSqlResult(client, query) {
    if (!query.trim()) {
        vscode.window.showErrorMessage('ClearQuery: Nothing to export — write a SQL query first.');
        return;
    }
    if (!(0, connection_1.isMariaDbConfigured)()) {
        vscode.window.showErrorMessage('ClearQuery: No MariaDB connection configured. Open Settings → ClearQuery → Connection.');
        return;
    }
    // ── Options dialog ────────────────────────────────────────────────────────
    const encodingChoice = await vscode.window.showQuickPick([
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
    ], {
        title: 'Export — CSV encoding',
        placeHolder: 'Pick an encoding',
    });
    if (encodingChoice === undefined) {
        return;
    } // Escape → abort
    const encoding = encodingChoice.label;
    const separatorChoice = await vscode.window.showQuickPick([
        { label: ';', description: 'Semicolon (default in French/European Excel)' },
        { label: ',', description: 'Comma (default in English Excel)' },
        { label: '\\t', description: 'Tab' },
        { label: '|', description: 'Pipe' },
    ], {
        title: 'Export — CSV separator',
        placeHolder: 'Pick a separator',
    });
    if (separatorChoice === undefined) {
        return;
    } // Escape → abort
    const separator = separatorChoice.label === '\\t' ? '\t' : separatorChoice.label;
    // ── Export with progress ──────────────────────────────────────────────────
    let result;
    let exportError;
    let cancelled = false;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'ClearQuery: Exporting…',
        cancellable: false,
    }, async () => {
        try {
            const r = await (0, connection_1.withConnection)(conn => client.send('export_sql_result', {
                workspace_path: client.path,
                query,
                connection: conn,
                encoding: encoding.trim(),
                separator,
            }));
            if (r === undefined) {
                cancelled = true;
            }
            else {
                result = r;
            }
        }
        catch (err) {
            exportError = err instanceof Error ? err.message : String(err);
        }
    });
    if (cancelled) {
        return;
    }
    if (exportError) {
        vscode.window.showErrorMessage(`ClearQuery: Export failed — ${exportError}`, { modal: true });
        return;
    }
    if (result) {
        const n = result.rows;
        const choice = await vscode.window.showInformationMessage(`ClearQuery: Exported ${n} row${n !== 1 ? 's' : ''} → ${result.export_path}`, 'Open folder');
        if (choice === 'Open folder') {
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.export_path));
        }
    }
}
//# sourceMappingURL=export.js.map