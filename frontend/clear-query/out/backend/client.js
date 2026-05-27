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
exports.BackendClient = exports.BackendError = void 0;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ─── Errors ──────────────────────────────────────────────────────────────────
class BackendError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BackendError';
    }
}
exports.BackendError = BackendError;
// ─── BackendClient ───────────────────────────────────────────────────────────
class BackendClient {
    workspacePath;
    pythonPath;
    extensionPath;
    proc;
    buffer = '';
    nextId = 1;
    pending = new Map();
    _status = 'starting';
    _statusEmitter = new vscode.EventEmitter();
    onDidChangeStatus = this._statusEmitter.event;
    restartCount = 0;
    maxRestarts = 3;
    disposed = false;
    _cancelling = false;
    constructor(workspacePath, pythonPath, extensionPath) {
        this.workspacePath = workspacePath;
        this.pythonPath = pythonPath;
        this.extensionPath = extensionPath;
        this.start();
    }
    get status() {
        return this._status;
    }
    get path() {
        return this.workspacePath;
    }
    // ── Lifecycle ────────────────────────────────────────────────────────────
    start() {
        if (this.disposed) {
            return;
        }
        // Production: bundled at extensionPath/backend/src
        // Development (F5): backend lives two levels up at ../../backend/src
        const bundled = path.join(this.extensionPath, 'backend', 'src');
        const devPath = path.join(this.extensionPath, '..', '..', 'backend', 'src');
        const backendSrc = fs.existsSync(bundled) ? bundled : devPath;
        // Vendored dependencies: bundled at extensionPath/backend/vendor
        // In dev the venv already has the packages, so vendor is optional.
        const vendorPath = path.join(this.extensionPath, 'backend', 'vendor');
        const pythonPaths = [backendSrc];
        if (fs.existsSync(vendorPath)) {
            pythonPaths.push(vendorPath);
        }
        if (process.env.PYTHONPATH) {
            pythonPaths.push(process.env.PYTHONPATH);
        }
        const env = {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            // Force UTF-8 for all Python I/O regardless of the Windows system locale.
            // Without this, sys.stdout defaults to cp1252 on Windows and Node.js
            // (which reads the pipe as UTF-8) misinterprets accented characters.
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
            PYTHONPATH: pythonPaths.join(path.delimiter),
        };
        this.proc = (0, child_process_1.spawn)(this.pythonPath, ['-m', 'clear_query.messaging'], {
            cwd: path.dirname(this.workspacePath),
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.buffer = '';
        this.setStatus('starting');
        this.proc.stdout?.on('data', (chunk) => this.onData(chunk));
        this.proc.stderr?.on('data', (chunk) => {
            const text = chunk.toString().trim();
            if (text) {
                vscode.window.showWarningMessage(`ClearQuery backend: ${text}`);
            }
        });
        this.proc.on('exit', (code) => {
            if (!this.disposed) {
                this.onExit(code);
            }
        });
    }
    onData(chunk) {
        this.buffer += chunk.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            try {
                const resp = JSON.parse(trimmed);
                this.dispatch(resp);
            }
            catch {
                // non-JSON output — ignore
            }
        }
    }
    dispatch(resp) {
        // First response received — backend is ready
        if (this._status === 'starting') {
            this.setStatus('ready');
            this.restartCount = 0;
        }
        const entry = this.pending.get(resp.id);
        if (!entry) {
            return;
        }
        clearTimeout(entry.timer);
        this.pending.delete(resp.id);
        if (resp.success) {
            entry.resolve(resp.data);
        }
        else {
            entry.reject(new BackendError(resp.error ?? 'Unknown backend error'));
        }
    }
    onExit(code) {
        this.rejectAll(new BackendError('Backend process exited unexpectedly'));
        // User-initiated cancel: restart cleanly without counting it as a crash
        if (this._cancelling) {
            this._cancelling = false;
            this.restartCount = 0;
            this.setStatus('starting');
            setTimeout(() => this.start(), 500);
            return;
        }
        if (this.restartCount < this.maxRestarts) {
            this.restartCount++;
            this.setStatus('starting');
            setTimeout(() => this.start(), 2000);
        }
        else {
            this.setStatus('error');
            vscode.window
                .showErrorMessage(`ClearQuery backend crashed after ${this.maxRestarts} restart attempts (exit code ${code}).`, 'Restart')
                .then(choice => {
                if (choice === 'Restart') {
                    this.restartCount = 0;
                    this.start();
                }
            });
        }
    }
    setStatus(s) {
        this._status = s;
        this._statusEmitter.fire(s);
    }
    rejectAll(err) {
        for (const [, entry] of this.pending) {
            clearTimeout(entry.timer);
            entry.reject(err);
        }
        this.pending.clear();
    }
    // ── Public API ───────────────────────────────────────────────────────────
    send(command, args = {}) {
        return new Promise((resolve, reject) => {
            if (!this.proc?.stdin) {
                reject(new BackendError('Backend process not running'));
                return;
            }
            const id = String(this.nextId++);
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new BackendError(`Request "${command}" timed out after 15 minutes`));
            }, 15 * 60 * 1000);
            this.pending.set(id, {
                resolve: resolve,
                reject,
                timer,
            });
            const req = { id, command, args };
            this.proc.stdin.write(JSON.stringify(req) + '\n');
        });
    }
    cancelQuery() {
        this._cancelling = true;
        this.rejectAll(new BackendError('Query cancelled'));
        try {
            this.proc?.kill('SIGTERM');
        }
        catch { /* ignore */ }
        // onExit fires next and restarts cleanly because _cancelling is set
    }
    dispose() {
        this.disposed = true;
        this.rejectAll(new BackendError('Backend client disposed'));
        this.setStatus('stopped');
        try {
            this.proc?.kill('SIGTERM');
        }
        catch { /* ignore */ }
        this._statusEmitter.dispose();
    }
}
exports.BackendClient = BackendClient;
//# sourceMappingURL=client.js.map