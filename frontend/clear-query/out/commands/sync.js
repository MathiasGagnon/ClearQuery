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
exports.initSyncCommands = initSyncCommands;
exports.syncSources = syncSources;
const vscode = __importStar(require("vscode"));
const workspace_1 = require("./workspace");
const connection_1 = require("./connection");
function initSyncCommands(context, tree) {
    context.subscriptions.push(vscode.commands.registerCommand('clearquery.syncSources', () => syncSources(tree)));
}
// ─── Main sync flow ───────────────────────────────────────────────────────────
async function syncSources(tree) {
    let client;
    try {
        client = (0, workspace_1.requireClient)();
    }
    catch (err) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        return;
    }
    const needsDb = (0, connection_1.isMariaDbConfigured)();
    let parquetCount = 0;
    let mariaDbResult;
    let mariaDbError;
    let mariaDbCancelled = false;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'ClearQuery',
        cancellable: false,
    }, async (progress) => {
        // ── Step 1: Save to parquet ──────────────────────────────────────
        progress.report({ message: 'Saving sources to parquet…' });
        let saved;
        try {
            saved = await client.send('save_sources_to_parquet', {
                workspace_path: client.path,
            });
            parquetCount = saved.saved_files.length;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`ClearQuery: failed to save parquet — ${msg}`);
            return;
        }
        // ── Refresh tree so artifact icons update ────────────────────────
        progress.report({ message: `Saved ${parquetCount} file(s). Refreshing…`, increment: 50 });
        await tree.refresh();
        // ── Step 2: Sync to MariaDB ──────────────────────────────────────
        if (!needsDb) {
            return;
        }
        progress.report({ message: 'Syncing temp tables to MariaDB…', increment: 25 });
        try {
            const result = await (0, connection_1.withConnection)(conn => client.send('sync_sources_to_temp_tables', {
                workspace_path: client.path,
                connection: conn,
            }));
            if (result === undefined) {
                mariaDbCancelled = true;
            }
            else {
                mariaDbResult = result;
            }
        }
        catch (err) {
            mariaDbError = err instanceof Error ? err.message : String(err);
        }
    });
    // ── Post-progress notifications ───────────────────────────────────────────
    if (!needsDb) {
        const choice = await vscode.window.showInformationMessage(`ClearQuery: ${parquetCount} parquet file(s) saved. ` +
            'Configure a MariaDB connection to also sync temp tables.', 'Configure');
        if (choice === 'Configure') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'clearquery.connection');
        }
        return;
    }
    if (mariaDbCancelled) {
        return;
    } // user cancelled password prompt
    if (mariaDbError) {
        vscode.window.showErrorMessage(`ClearQuery: MariaDB sync failed — ${mariaDbError}`, { modal: true });
        return;
    }
    if (mariaDbResult) {
        const n = mariaDbResult.synced_tables.length;
        vscode.window.showInformationMessage(`ClearQuery: Synced ${n} table${n !== 1 ? 's' : ''} to MariaDB.`);
    }
}
//# sourceMappingURL=sync.js.map