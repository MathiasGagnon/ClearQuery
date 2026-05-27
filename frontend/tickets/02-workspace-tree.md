# Ticket 02 — Workspace Tree (Activity Bar side panel)

## Goal
Display the workspace contents in the VSCode Explorer-style side panel:
sources, their type, sync status, and recipe steps — all from a `TreeDataProvider`.

## Depends on
Ticket 01 (BackendClient)

## Scope

### Activity Bar registration (`package.json`)

```json
"viewsContainers": {
    "activitybar": [{
        "id": "clearquery",
        "title": "ClearQuery",
        "icon": "resources/icon.svg"
    }]
},
"views": {
    "clearquery": [{
        "id": "clearquery.workspaceTree",
        "name": "Workspace"
    }]
}
```

### Tree node hierarchy

```
📁 my_workspace
├── 🗂 sales_data  [csv]  ✅            ← has parquet artifact
│   ├── set_type: id → int
│   ├── set_type: amount → float
│   └── set_type: created_at → datetime
├── 🗂 customers  [csv]  ⚠ sync needed  ← no artifact
│   └── (no recipe steps)
└── + Add source…
```

**Node types:**
- `WorkspaceNode` — root (workspace name, not collapsible label)
- `SourceNode` — source name + type badge + artifact status icon
- `RecipeStepNode` — step index + operation type + key params summary
- `AddSourceNode` — static "＋ Add source…" action node

**Artifact status** is determined from `get_sources_schema` `schema_source` field:
- `parquet_artifact` → green check icon
- `none` → warning icon + "(sync needed)" label

### `views/workspaceTree.ts` — `WorkspaceTreeProvider`

- Implements `vscode.TreeDataProvider<TreeNode>`.
- Calls `get_sources_schema` on construction and after every mutating command.
- Calls `list_source_recipe` per source to populate recipe children.
- `getChildren(node)` returns the appropriate child list for each node type.
- `refresh()` method re-fetches from backend and fires `_onDidChangeTreeData`.

### Commands wired to tree nodes (context menus)

Register these commands in `package.json` and implement in `commands/source.ts` and
`commands/recipe.ts`:

| Command                        | Node type        | Action                           |
|-------------------------------|------------------|----------------------------------|
| `clearquery.removeSource`     | `SourceNode`     | Calls `remove_source`, refreshes |
| `clearquery.previewSource`    | `SourceNode`     | Opens source preview (ticket 03) |
| `clearquery.removeRecipeStep` | `RecipeStepNode` | Calls `remove_recipe_step`       |

### "Add source" flow

Triggered by clicking the `AddSourceNode` or a toolbar `+` button:
1. `vscode.window.showOpenDialog` → pick a CSV or XLSX file.
2. Derive source name from filename stem (user can edit via `showInputBox`).
3. Call `add_source` with the file path.
4. Refresh tree.
5. Show info notification: "Source 'X' added. Recipe type steps auto-inferred."

### "Load / create workspace" commands

- `clearquery.openWorkspace` — `showOpenDialog` for a `workspace.json`, then
  `load_workspace`, refresh tree.
- `clearquery.newWorkspace` — `showSaveDialog` for a directory, `showInputBox` for
  name, call `create_workspace`, refresh tree.
- Both commands appear in the tree view's title bar buttons.

## Acceptance Criteria
- Tree shows all sources with correct artifact status icons.
- Recipe steps are shown as children when the source is expanded.
- Right-clicking a source shows "Preview" and "Remove".
- Right-clicking a recipe step shows "Remove".
- Adding a source updates the tree within 1 s.
- No source/step is silently dropped if the backend errors — show the error in a
  VSCode error notification instead.
