# Ticket 04 — SQL Panel (editor + results)

## Goal
A WebviewPanel that gives the user a SQL editor, a "Run preview" button, and a tabbed
results area (Raw JSON tab + Table tab). This is the main work surface of the extension.

## Depends on
Ticket 01, Ticket 02

## Scope

### `views/sqlPanel.ts` — `SqlPanel`

- Opened via command `clearquery.openSqlPanel` (toolbar button or command palette).
- Single instance per workspace — reuse if already open.
- Panel title: `"SQL — <workspace_name>"`.
- `ViewColumn.One` (main editor area).

### Webview (`webviews/sql/`)

**Layout (three vertical regions)**

```
┌─────────────────────────────────────┐
│  Sources pane (left, resizable)     │  ← ticket 04a below
│                                     │
├─────────────────────────────────────┤
│  SQL editor area                    │
│  [Run preview]  [Export]  [Clear]   │
├──────────────┬──────────────────────┤
│  Raw  │ Table│  Results tabs        │
│             (scrollable table)      │
└─────────────────────────────────────┘
```

Implement using a CSS Grid / Flexbox layout with a draggable splitter between the
sources pane and the right column.

---

### 04a — Sources pane (left column)

Mirrors the tkinter sources tree:
- Lists all sources from `get_sources_schema`.
- Sources **with** parquet artifact: shown normally, children = columns with dtype.
- Sources **without** artifact: greyed out, labelled "(sync needed)".
- Double-clicking a column inserts `{source_name.column_name}` at the cursor in the
  SQL editor (same as tkinter double-click behaviour).
- **Toolbar**: `[Refresh]` and `[Sync sources]` buttons at the top of the pane.
  - "Sync sources" calls the sync flow (ticket 05).

---

### 04b — SQL editor area

Use a `<textarea>` with monospace font and line numbers for v1.
(A follow-up ticket can upgrade to a Monaco editor embed.)

- Keyboard shortcut: `Ctrl+Enter` / `Cmd+Enter` runs the preview.
- Placeholder text: `-- Write your SQL query here\n-- Double-click a column on the left to insert it`.

---

### 04c — Running a query

On "Run preview":
1. Read connection details from settings (ticket 07).
2. Call `sql_preview` with `{ connection, query, limit }`.
3. Show spinner in results area while pending.
4. On success: populate both tabs.
5. On error: show error banner inside the results area (not a modal).

---

### 04d — Results tabs

**Raw tab**
- Shows the full JSON response in a `<pre>` block with syntax highlighting.

**Table tab**
- Same rendering component as the source preview (ticket 03) — share the code.
- Column headers show name only (no dtype, since SQL results have no dtype metadata).
- Null cells shown as greyed `∅`.
- Row count shown below the table.

---

### Connection settings bar (compact)

At the top of the SQL pane, show a compact read-only connection summary:
`Host: localhost  DB: mydb  User: root`

Clicking it opens the connection settings (ticket 07) so the user can change them
without leaving the panel.

## Acceptance Criteria
- SQL panel opens from command palette and activity bar.
- Typing SQL and pressing Ctrl+Enter runs the preview.
- Double-clicking a column in the sources pane inserts the token.
- Results display in both Raw and Table tabs.
- Query errors are shown as inline banners, not modal dialogs.
- Sources pane correctly grey-outs sources with no artifact.
