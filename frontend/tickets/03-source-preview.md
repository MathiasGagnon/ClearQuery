# Ticket 03 — Source Preview Webview

## Goal
When the user clicks "Preview" on a source in the tree, open a WebviewPanel that shows
the source data as a styled table — identical to the "Preview" tab in the tkinter app.

## Depends on
Ticket 01, Ticket 02

## Scope

### `views/sourcePreview.ts` — `SourcePreviewPanel`

- Static `create(client, sourceName, workspacePath)` factory.
  - Reuses an existing panel if one is already open for the same source.
- Calls `get_preview` with `limit: 500`.
- Posts the `{ columns, rows, dtypes }` payload to the webview.
- Panel title: `"Preview: <source_name>"`.
- Column `type=ViewColumn.Beside` — opens next to the current editor, not replacing it.

### Webview (`webviews/preview/`)

**`index.html`**  
Minimal shell: a `<div id="root">` plus `<script src="main.js">`.

**`main.js`**
- Listens for `window.addEventListener('message', ...)` from the extension.
- On a `type: 'data'` message: renders the table.
- On a `type: 'loading'` message: shows a spinner.
- On a `type: 'error'` message: shows an error banner.

**Table rendering**
- Sticky header row.
- Column header shows `name (dtype)` — e.g. `amount (float64)`.
- Null/empty cells shown as a greyed-out `∅`.
- Alternating row background for readability.
- Horizontal scroll if columns overflow.
- Row count shown below the table: "Showing 500 of N rows" (N from a follow-up
  `get_sources_schema` call) or just "Showing N rows" if N ≤ limit.

**Styling**
- Use VSCode CSS variables (`--vscode-editor-background`, `--vscode-foreground`,
  `--vscode-list-hoverBackground`, etc.) so the table respects the user's theme.

### Refresh button
A "↻ Refresh" button in the webview toolbar re-calls `get_preview` and re-renders.

## Acceptance Criteria
- Clicking "Preview" on a source opens a panel showing its data.
- Opening preview on a source with no parquet artifact still works (goes to raw file).
- Column dtypes are shown in headers.
- The panel respects light and dark VSCode themes.
- Refreshing picks up changes if the source file was updated.
