import * as vscode from 'vscode';
import { requireClient } from './workspace';
import { WorkspaceTreeProvider } from '../views/workspaceTree';
import { isMariaDbConfigured, withConnection } from './connection';
import { SavedFilesPayload, SyncedTablesPayload } from '../backend/types';

export function initSyncCommands(
    context: vscode.ExtensionContext,
    tree: WorkspaceTreeProvider,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('clearquery.syncSources', () =>
            syncSources(tree),
        ),
    );
}

// ─── Main sync flow ───────────────────────────────────────────────────────────

export async function syncSources(tree: WorkspaceTreeProvider): Promise<void> {
    let client: ReturnType<typeof requireClient>;
    try { client = requireClient(); } catch (err: unknown) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        return;
    }

    const needsDb = isMariaDbConfigured();

    let parquetCount = 0;
    let mariaDbResult: SyncedTablesPayload | undefined;
    let mariaDbError: string | undefined;
    let mariaDbCancelled = false;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'ClearQuery',
            cancellable: false,
        },
        async progress => {
            // ── Step 1: Save to parquet ──────────────────────────────────────
            progress.report({ message: 'Saving sources to parquet…' });

            let saved: SavedFilesPayload;
            try {
                saved = await client.send<SavedFilesPayload>('save_sources_to_parquet', {
                    workspace_path: client.path,
                });
                parquetCount = saved.saved_files.length;
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`ClearQuery: failed to save parquet — ${msg}`);
                return;
            }

            // ── Refresh tree so artifact icons update ────────────────────────
            progress.report({ message: `Saved ${parquetCount} file(s). Refreshing…`, increment: 50 });
            await tree.refresh();

            // ── Step 2: Sync to MariaDB ──────────────────────────────────────
            if (!needsDb) { return; }

            progress.report({ message: 'Syncing temp tables to MariaDB…', increment: 25 });

            try {
                const result = await withConnection(conn =>
                    client.send<SyncedTablesPayload>('sync_sources_to_temp_tables', {
                        workspace_path: client.path,
                        connection: conn,
                    }),
                );
                if (result === undefined) {
                    mariaDbCancelled = true;
                } else {
                    mariaDbResult = result;
                }
            } catch (err: unknown) {
                mariaDbError = err instanceof Error ? err.message : String(err);
            }
        },
    );

    // ── Post-progress notifications ───────────────────────────────────────────

    if (!needsDb) {
        const choice = await vscode.window.showInformationMessage(
            `ClearQuery: ${parquetCount} parquet file(s) saved. ` +
            'Configure a MariaDB connection to also sync temp tables.',
            'Configure',
        );
        if (choice === 'Configure') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'clearquery.connection');
        }
        return;
    }

    if (mariaDbCancelled) { return; }   // user cancelled password prompt

    if (mariaDbError) {
        vscode.window.showErrorMessage(
            `ClearQuery: MariaDB sync failed — ${mariaDbError}`,
            { modal: true },
        );
        return;
    }

    if (mariaDbResult) {
        const n = mariaDbResult.synced_tables.length;
        vscode.window.showInformationMessage(
            `ClearQuery: Synced ${n} table${n !== 1 ? 's' : ''} to MariaDB.`,
        );
    }
}
