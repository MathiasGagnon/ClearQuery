# Architecture — ClearQuery VSCode Extension

## Core Concept

ClearQuery is a **VSCode extension** that users install once. They then open any
**project folder** (a directory containing a `workspace.json`) in VSCode and the
extension activates to work on that project. The extension and the project are
completely separate.

```
User's project folder (opened in VSCode)
├── workspace.json          ← ClearQuery workspace definition
├── data/
│   ├── sales.csv
│   └── customers.xlsx
├── artifacts/              ← written by the extension (parquet files)
│   ├── sales.parquet
│   └── customers.parquet
└── export_20260527_103706/ ← written by the extension (exports)
    └── ...

ClearQuery extension (installed in VSCode, separate)
└── activates when a workspace.json is present/selected
```

---

## Process model

```
VSCode extension (TypeScript)
    └── spawns: python -m clear_query.messaging
                stdin  ← JSON request lines
                stdout → JSON response lines
                stderr → surfaced as VSCode warnings
```

The Python backend is resolved from the `clearquery.pythonPath` setting (see ticket 07).
One backend process is spawned per active `workspace.json`. It is killed when the user
closes the workspace or deactivates the extension.

---

## Activation and workspace selection

The extension activates on VSCode startup if already configured, or when the user runs
`ClearQuery: Open Workspace` from the command palette.

**Workspace selection flow:**
1. On activate, check if `vscode.workspace.workspaceFolders` contains a `workspace.json`
   at the root → if yes, offer to auto-load it.
2. Otherwise, `ClearQuery: Open Workspace` opens a file picker filtered to `workspace.json`.
3. `ClearQuery: New Workspace` creates a new `workspace.json` in the currently open folder.

The selected `workspace.json` path is stored in VSCode workspace-scoped settings
(`clearquery.activeWorkspacePath`) so it persists across restarts.

---

## UI model

| Area              | VSCode primitive           | Purpose                                       |
|-------------------|----------------------------|-----------------------------------------------|
| Activity Bar icon | `viewsContainers` + icon   | Entry point — opens the side panel            |
| Side panel        | `TreeView` (custom)        | Sources tree + recipe steps + artifact status |
| SQL editor pane   | `WebviewPanel`             | SQL editor, results table, export button      |
| Source preview    | `WebviewPanel`             | Tabular preview of a source                   |
| Status bar        | `StatusBarItem`            | Backend status + active workspace name        |
| Notifications     | `window.showInformation…`  | Sync done, export done, errors                |

---

## Communication layer (TypeScript)

A single `BackendClient` class wraps the child process:
- Assigns a unique `id` to each request
- Stores a `Map<id, Promise resolver>` so callers can `await` responses
- Emits events for unsolicited messages (backend stderr, unexpected output)

---

## Development vs. installed extension

When **developing** the extension (F5 debug):
- VSCode launches an Extension Development Host window
- In that window, open a **project folder** (e.g. `backend/new project/`) as the workspace
- The extension activates in that window and works on the project files there
- The extension source folder (`frontend/clear-query`) is never the opened workspace

When **installed**:
- User opens any project folder containing a `workspace.json`
- Extension activates automatically

The `.vscode/launch.json` should pass `--folder-uri` pointing to a test project for
convenient development (see ticket 01).

---

## Folder layout (target)

```
frontend/clear-query/src/
    extension.ts          — activate / deactivate, singleton BackendClient
    backend/
        client.ts         — BackendClient: spawn, send, receive
        types.ts          — request/response TypeScript types
    views/
        workspaceTree.ts  — TreeDataProvider for the side panel
        sqlPanel.ts       — WebviewPanel: SQL editor + results
        sourcePreview.ts  — WebviewPanel: tabular source preview
    webviews/
        sql/              — HTML + CSS + JS for the SQL webview
        preview/          — HTML + CSS + JS for the preview webview
    commands/
        workspace.ts      — open, create, select workspace.json
        source.ts         — add, remove source
        recipe.ts         — add, update, remove recipe step
        sync.ts           — sync sources (parquet + temp tables)
        export.ts         — export SQL result
    settings.ts           — typed wrapper for vscode.workspace.getConfiguration
```

---

## Ticket reading order

1. `01-backend-client.md` — stdio bridge + workspace selection (everything else needs this)
2. `02-workspace-tree.md` — side panel showing sources and their recipe
3. `03-source-preview.md` — tabular preview webview
4. `04-sql-panel.md` — SQL editor + results tabs
5. `05-sync-sources.md` — sync button (parquet + temp tables)
6. `06-export.md` — export button with options dialog
7. `07-connection-settings.md` — persisted MariaDB connection config
