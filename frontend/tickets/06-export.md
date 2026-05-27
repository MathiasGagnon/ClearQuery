# Ticket 06 — Export SQL Result

## Goal
Implement the "Export" button in the SQL panel that runs the current query and saves a
full versioned snapshot (parquet files, workspace, DDL, INSERT script, query, CSV result)
to a timestamped directory next to `workspace.json`.

## Depends on
Ticket 01, Ticket 04, Ticket 07

## Scope

### `commands/export.ts` — `exportSqlResult()`

**Flow:**

```
1. Read query from SQL panel state.
   If empty → show error notification, abort.
2. Read connection details from settings (ticket 07).
   If missing → show error, abort.
3. Show a Quick Pick / input dialog for export options:
      Encoding  (default: utf-8)
      Separator (default: ;)
4. Show progress: "ClearQuery: Exporting…"
5. Call  export_sql_result  {
       workspace_path, query, connection,
       encoding, separator
   }
6. On success:
   - Show info notification:
     "Exported N rows to <export_dir>"
     with an "Open folder" button that calls:
       vscode.commands.executeCommand('revealFileInOS', exportDirUri)
7. On error:
   - Show modal error with the backend error string.
```

### Options dialog

Use two consecutive `vscode.window.showInputBox` calls (simple) or a custom Quick Pick
flow for v1.

```
Encoding [utf-8    ]    ← pre-filled default
Separator [;       ]    ← pre-filled default
```

User can press Escape to cancel at either prompt.

### Wiring

- Register `clearquery.exportSqlResult` command.
- "Export" button in the SQL panel run row (next to "Run preview"), same as tkinter.
- Keyboard shortcut: `Ctrl+Shift+E` / `Cmd+Shift+E` (optional, configurable).

## Acceptance Criteria
- Export button appears next to "Run preview" in the SQL panel.
- Options dialog pre-fills with defaults.
- Export directory is created next to `workspace.json` with correct timestamp name.
- After export, a notification with "Open folder" button appears.
- Cancelling the options dialog aborts cleanly, no directory is created.
- MariaDB errors (e.g., query fails) are surfaced as a modal error message.

## Export directory contents (for reference, produced by backend)
```
export_YYYYMMDD_HHMMSS/
├── artifacts/          ← parquet snapshots
├── workspace.json      ← workspace state at export time
├── create_tables.sql   ← CREATE TABLE DDL
├── insert_data.sql     ← INSERT statements
├── query.sql           ← the executed SQL
└── result.csv          ← query result (chosen encoding + separator)
```
