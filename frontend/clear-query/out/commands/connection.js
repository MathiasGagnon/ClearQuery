"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMariaDbConfigured = isMariaDbConfigured;
exports.buildConnection = buildConnection;
exports.clearPassword = clearPassword;
exports.withConnection = withConnection;
const vscode = __importStar(require("vscode"));
// Password is held in memory only — never written to disk or settings.
let _cachedPassword;
// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Returns true when host/database/user are all filled in settings.
 * Does NOT require a password to be cached yet.
 */
function isMariaDbConfigured() {
    const cfg = vscode.workspace.getConfiguration('clearquery');
    const database = cfg.get('connection.database') ?? '';
    const user = cfg.get('connection.user') ?? '';
    return Boolean(database.trim() && user.trim());
}
/**
 * Assembles the full connection object for the backend.
 * Prompts for the password the first time (or if it was cleared).
 * Returns undefined if the user cancels the password prompt.
 */
async function buildConnection() {
    const cfg = vscode.workspace.getConfiguration('clearquery');
    const password = await acquirePassword();
    if (password === undefined) {
        return undefined;
    } // user cancelled
    return {
        host: cfg.get('connection.host') ?? 'localhost',
        port: cfg.get('connection.port') ?? 3306,
        database: cfg.get('connection.database') ?? '',
        user: cfg.get('connection.user') ?? '',
        password,
    };
}
/**
 * Clears the in-memory password so the next DB operation will re-prompt.
 * Call on extension deactivate or when the user wants to re-enter credentials.
 */
function clearPassword() {
    _cachedPassword = undefined;
}
/**
 * Runs `fn` with a built connection object.
 * If the call throws a connection/auth error, clears the cached password,
 * re-prompts once, and retries.  Any other error is re-thrown unchanged.
 * Returns undefined only when the user cancels a password prompt.
 */
async function withConnection(fn) {
    let conn = await buildConnection();
    if (conn === undefined) {
        return undefined;
    }
    try {
        return await fn(conn);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isConnectionError(msg)) {
            throw err;
        } // not a credential problem
        // Auth/connection failure → clear cached password and re-prompt once
        clearPassword();
        conn = await buildConnection();
        if (conn === undefined) {
            return undefined;
        }
        return await fn(conn); // second attempt — let any error propagate
    }
}
// ── Internal ──────────────────────────────────────────────────────────────────
function isConnectionError(msg) {
    const lower = msg.toLowerCase();
    return (lower.includes('access denied') ||
        lower.includes('authentication') ||
        lower.includes("can't connect") ||
        lower.includes('connection refused') ||
        lower.includes('connection error') ||
        lower.includes('lost connection') ||
        lower.includes('server has gone away'));
}
async function acquirePassword() {
    if (_cachedPassword !== undefined) {
        return _cachedPassword;
    }
    const cfg = vscode.workspace.getConfiguration('clearquery');
    const user = cfg.get('connection.user') ?? '';
    const db = cfg.get('connection.database') ?? '';
    const input = await vscode.window.showInputBox({
        title: 'MariaDB Password',
        prompt: `Password for ${user}@${db} (held in memory only — never saved)`,
        password: true,
        ignoreFocusOut: true, // stays open if VS Code loses focus
    });
    if (input === undefined) {
        return undefined; // Escape pressed — abort
    }
    _cachedPassword = input; // empty string is valid (no-password DB)
    return _cachedPassword;
}
//# sourceMappingURL=connection.js.map