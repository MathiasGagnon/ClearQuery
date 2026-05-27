import * as vscode from 'vscode';

// Password is held in memory only — never written to disk or settings.
let _cachedPassword: string | undefined;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true when host/database/user are all filled in settings.
 * Does NOT require a password to be cached yet.
 */
export function isMariaDbConfigured(): boolean {
    const cfg = vscode.workspace.getConfiguration('clearquery');
    const database = cfg.get<string>('connection.database') ?? '';
    const user     = cfg.get<string>('connection.user')     ?? '';
    return Boolean(database.trim() && user.trim());
}

/**
 * Assembles the full connection object for the backend.
 * Prompts for the password the first time (or if it was cleared).
 * Returns undefined if the user cancels the password prompt.
 */
export async function buildConnection(): Promise<Record<string, unknown> | undefined> {
    const cfg = vscode.workspace.getConfiguration('clearquery');

    const password = await acquirePassword();
    if (password === undefined) { return undefined; }   // user cancelled

    return {
        host:     cfg.get<string>('connection.host')     ?? 'localhost',
        port:     cfg.get<number>('connection.port')     ?? 3306,
        database: cfg.get<string>('connection.database') ?? '',
        user:     cfg.get<string>('connection.user')     ?? '',
        password,
    };
}

/**
 * Clears the in-memory password so the next DB operation will re-prompt.
 * Call on extension deactivate or when the user wants to re-enter credentials.
 */
export function clearPassword(): void {
    _cachedPassword = undefined;
}

/**
 * Runs `fn` with a built connection object.
 * If the call throws a connection/auth error, clears the cached password,
 * re-prompts once, and retries.  Any other error is re-thrown unchanged.
 * Returns undefined only when the user cancels a password prompt.
 */
export async function withConnection<T>(
    fn: (conn: Record<string, unknown>) => Promise<T>,
): Promise<T | undefined> {
    let conn = await buildConnection();
    if (conn === undefined) { return undefined; }

    try {
        return await fn(conn);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isConnectionError(msg)) { throw err; }  // not a credential problem

        // Auth/connection failure → clear cached password and re-prompt once
        clearPassword();
        conn = await buildConnection();
        if (conn === undefined) { return undefined; }

        return await fn(conn);  // second attempt — let any error propagate
    }
}

// ── Internal ──────────────────────────────────────────────────────────────────

function isConnectionError(msg: string): boolean {
    const lower = msg.toLowerCase();
    return (
        lower.includes('access denied')      ||
        lower.includes('authentication')     ||
        lower.includes("can't connect")      ||
        lower.includes('connection refused') ||
        lower.includes('connection error')   ||
        lower.includes('lost connection')    ||
        lower.includes('server has gone away')
    );
}

async function acquirePassword(): Promise<string | undefined> {
    if (_cachedPassword !== undefined) {
        return _cachedPassword;
    }

    const cfg  = vscode.workspace.getConfiguration('clearquery');
    const user = cfg.get<string>('connection.user') ?? '';
    const db   = cfg.get<string>('connection.database') ?? '';

    const input = await vscode.window.showInputBox({
        title: 'MariaDB Password',
        prompt: `Password for ${user}@${db} (held in memory only — never saved)`,
        password: true,
        ignoreFocusOut: true,   // stays open if VS Code loses focus
    });

    if (input === undefined) {
        return undefined;   // Escape pressed — abort
    }

    _cachedPassword = input;    // empty string is valid (no-password DB)
    return _cachedPassword;
}
