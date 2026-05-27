# Ticket 07 — Connection Settings & Extension Configuration

## Goal
Persist the MariaDB connection details and the Python interpreter path using VSCode's
built-in settings API, so they survive restarts and are workspace-scoped.

## Depends on
Ticket 01

## Scope

### `package.json` — configuration contribution

```json
"configuration": {
    "title": "ClearQuery",
    "properties": {
        "clearquery.activeWorkspacePath": {
            "type": "string",
            "default": "",
            "scope": "window",
            "description": "Path to the active workspace.json file. Set automatically by 'ClearQuery: Open Workspace'."
        },
        "clearquery.pythonPath": {
            "type": "string",
            "default": "python",
            "description": "Path to the Python executable used to run the backend."
        },
        "clearquery.connection.host": {
            "type": "string",
            "default": "localhost"
        },
        "clearquery.connection.port": {
            "type": "number",
            "default": 3306
        },
        "clearquery.connection.database": {
            "type": "string",
            "default": ""
        },
        "clearquery.connection.user": {
            "type": "string",
            "default": ""
        },
        "clearquery.connection.password": {
            "type": "string",
            "default": "",
            "description": "Stored in plaintext in settings.json. Use a secrets manager for production."
        },
        "clearquery.sql.defaultLimit": {
            "type": "number",
            "default": 500,
            "description": "Default row limit for SQL preview queries."
        }
    }
}
```

### `backend/settings.ts` — `getSettings()`

A thin helper that reads VSCode configuration and returns a typed object:

```ts
interface ClearQuerySettings {
    pythonPath: string;
    connection: {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
    } | null;   // null if host/database/user are all empty
    sql: {
        defaultLimit: number;
    };
}
```

Returns `connection: null` if the required fields (host, database, user) are not set.
Callers use this to skip MariaDB-dependent steps gracefully.

### `clearquery.configureConnection` command

Opens the built-in VSCode settings UI filtered to the ClearQuery section:

```ts
vscode.commands.executeCommand(
    'workbench.action.openSettings',
    '@ext:clear-query connection'
);
```

Registered and exposed as:
- A button on the SQL panel connection bar (ticket 04)
- A "Configure connection" item at the bottom of the workspace tree
- The action button on the "no connection" notification (ticket 05)

### Backend restart on python path change

Listen to `vscode.workspace.onDidChangeConfiguration`:
- If `clearquery.pythonPath` changes → dispose and restart the `BackendClient`.
- If connection settings change → no restart needed (passed per-request).

## Acceptance Criteria
- All settings appear under "ClearQuery" in VSCode settings UI.
- `getSettings()` returns `connection: null` when fields are blank.
- Changing the Python path restarts the backend automatically.
- The `configureConnection` command opens settings filtered to the connection section.
- Password is stored in plaintext (document this clearly; keychain integration is a
  follow-up ticket).
