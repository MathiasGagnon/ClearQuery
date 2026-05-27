# Ticket 05 — Sync Sources (parquet + temp tables)

## Goal
Implement the "Sync sources" flow: save all sources to parquet artifacts, then load them
into MariaDB tables so they can be queried in the SQL panel.

## Depends on
Ticket 01, Ticket 02, Ticket 07 (connection settings)

## Scope

### `commands/sync.ts` — `syncSources()`

Called from both the workspace tree toolbar and the SQL panel sources pane toolbar.

**Flow:**

```
1. Show progress notification: "ClearQuery: Syncing sources…"
2. Call  save_sources_to_parquet  { workspace_path }
   → on error: show error notification, abort
3. Refresh the workspace tree (artifact icons update)
4. If MariaDB connection details are configured (ticket 07):
     Call  sync_sources_to_temp_tables  { workspace_path, connection }
     → on error: show error notification with the MariaDB error message
     → on success: show info notification "Synced N tables to MariaDB"
5. If no MariaDB connection configured:
     Show info notification:
     "Parquet files saved. Configure a MariaDB connection to also sync temp tables."
     with a "Configure" button that opens ticket 07.
```

**Progress**
Use `vscode.window.withProgress` with `ProgressLocation.Notification` to show a
dismissable progress indicator during both steps.

### Wiring

- Register `clearquery.syncSources` command.
- Add a toolbar button to the tree view title bar (sync icon `$(sync)`).
- Also called from the SQL panel "Sync sources" button (ticket 04a).

### Error handling

- Parquet errors: usually a source file missing or a dtype inference failure.
  Show the backend error string verbatim in the notification.
- MariaDB errors: show the error in a modal `showErrorMessage` since these often
  require connection troubleshooting.

## Acceptance Criteria
- Sync button appears in the workspace tree toolbar and SQL sources pane.
- After clicking, parquet files appear in `artifacts/` next to `workspace.json`.
- Artifact status icons in the tree update without a full reload.
- MariaDB tables are created/refreshed with the new data.
- If MariaDB is not configured, only the parquet step runs; user is told why.
- Progress bar is visible during the operation.
