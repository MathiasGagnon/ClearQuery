# Ticket 01 — Backend Client + Workspace Selection

## Goal
Implement the TypeScript layer that:
1. Lets the user select (or auto-detect) a `workspace.json` in their open project folder
2. Spawns the Python backend scoped to that workspace
3. Provides an async `send()` API used by every other ticket

## Background

The Python backend reads newline-delimited JSON from stdin and writes it to stdout:

```
→  {"id": "1", "command": "load_workspace", "args": {"workspace_path": "..."}}
←  {"id": "1", "success": true, "data": {...}}
←  {"id": "1", "success": false, "error": "..."}
```

The backend is a standalone process. It does not know about VSCode. The extension owns
the process lifecycle.

---

## Scope

### `backend/types.ts`

TypeScript interfaces mirroring the backend protocol:

```ts
interface BackendRequest {
    id: string;
    command: string;
    args: Record<string, unknown>;
}

interface BackendResponse {
    id: string;
    success: boolean;
    data?: unknown;
    error?: string;
}
```

Typed payload interfaces for each command:
`WorkspacePayload`, `PreviewPayload`, `SourcesSchemaPayload`, `SavedFilesPayload`, etc.

---

### `backend/client.ts` — `BackendClient`

**Constructor**  
`new BackendClient(workspacePath: string, pythonPath: string)`

- Builds `PYTHONPATH` = `<extension>/backend/src` (absolute path via
  `context.extensionUri`).
- Spawns `python -m clear_query.messaging` with `cwd` = directory of `workspacePath`.
- Reads stdout line-by-line; dispatches each line to the matching pending promise.
- Collects stderr; surfaces it as a VSCode warning notification.
- Exposes `status: 'starting' | 'ready' | 'error' | 'stopped'` and a
  `onDidChangeStatus` EventEmitter.

**`send<T>(command, args): Promise<T>`**  
- Generates a unique request id.
- Serialises and writes to stdin.
- Returns a promise resolved/rejected when the matching response arrives.
- Rejects with a `BackendError` (extends `Error`) if `success === false`, carrying the
  backend error string.
- Rejects with a timeout error after 30 s.

**`dispose()`**  
- Sends `SIGTERM`, clears the pending map with errors.

**Auto-restart**  
- If the process exits unexpectedly: wait 2 s, restart, up to 3 retries.
- On the 3rd failure: set status `error`, show a VSCode error notification with a
  "Restart" button.

---

### `commands/workspace.ts` — workspace selection

**`selectWorkspace()`** — `clearquery.openWorkspace` command  
1. Show `vscode.window.showOpenDialog`:
   - `filters: { 'ClearQuery Workspace': ['json'] }`
   - `defaultUri` = first `vscode.workspace.workspaceFolders` root
2. Store chosen path in workspace-scoped setting `clearquery.activeWorkspacePath`.
3. (Re-)create the `BackendClient` with the new path.
4. Call `load_workspace` and fire a refresh event to update the tree.

**`newWorkspace()`** — `clearquery.newWorkspace` command  
1. `showSaveDialog` to pick a folder/name.
2. `showInputBox` for workspace name.
3. Call `create_workspace`.
4. Store path in setting, instantiate client, refresh tree.

**Auto-detect on activate**  
In `extension.ts activate()`:
1. Read `clearquery.activeWorkspacePath` from settings.
2. If set and file exists → create `BackendClient` silently.
3. Else if the open folder contains a `workspace.json` at its root → show info
   notification: _"ClearQuery workspace found. Open it?"_ with "Open" button.
4. Otherwise do nothing — user must run the command manually.

---

### `extension.ts`

```ts
let client: BackendClient | undefined;

export function activate(context: vscode.ExtensionContext) {
    // status bar
    // auto-detect workspace
    // register all commands
    // register tree view
}

export function getClient(): BackendClient {
    if (!client) throw new Error('Backend not started');
    return client;
}

export function deactivate() {
    client?.dispose();
}
```

---

### Status bar item

- Shows the active workspace name and backend status:
  - `$(gear~spin) ClearQuery: starting`
  - `$(check) ClearQuery: my_workspace`
  - `$(error) ClearQuery: error`
  - `$(circle-slash) ClearQuery: no workspace`
- Clicking it runs `clearquery.openWorkspace`.

---

### `.vscode/launch.json` update

Add `--folder-uri` to automatically open a test project in the Extension Development
Host, so F5 doesn't open an empty window:

```json
{
    "name": "Run Extension",
    "type": "extensionHost",
    "request": "launch",
    "args": [
        "--extensionDevelopmentPath=${workspaceFolder}",
        "--folder-uri", "file:///path/to/ClearQuery/backend/new project"
    ],
    "outFiles": ["${workspaceFolder}/out/**/*.js"],
    "preLaunchTask": "${defaultBuildTask}"
}
```

Use a relative or repo-rooted path so it works for all contributors.

---

## Acceptance Criteria
- F5 opens an Extension Development Host with a test project folder loaded.
- If the test folder has a `workspace.json` at its root, a notification offers to open it.
- `clearquery.openWorkspace` lets the user pick any `workspace.json`.
- After selecting, the status bar shows the workspace name and `ready` status.
- `client.send("load_workspace", { workspace_path })` resolves with workspace data.
- A failed backend response rejects the promise with the backend error string.
- Backend crash triggers auto-restart up to 3 times with status bar feedback.
