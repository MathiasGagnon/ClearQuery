import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BackendRequest, BackendResponse } from './types';

// ─── Errors ──────────────────────────────────────────────────────────────────

export class BackendError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BackendError';
    }
}

// ─── Status ──────────────────────────────────────────────────────────────────

export type BackendStatus = 'starting' | 'ready' | 'error' | 'stopped';

// ─── BackendClient ───────────────────────────────────────────────────────────

export class BackendClient implements vscode.Disposable {
    private proc: ChildProcess | undefined;
    private buffer = '';
    private nextId = 1;
    private pending = new Map<string, {
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
        timer: NodeJS.Timeout;
    }>();

    private _status: BackendStatus = 'starting';
    private _statusEmitter = new vscode.EventEmitter<BackendStatus>();
    readonly onDidChangeStatus = this._statusEmitter.event;

    private restartCount = 0;
    private readonly maxRestarts = 3;
    private disposed = false;

    constructor(
        private readonly workspacePath: string,
        private readonly pythonPath: string,
        private readonly extensionPath: string,
    ) {
        this.start();
    }

    get status(): BackendStatus {
        return this._status;
    }

    get path(): string {
        return this.workspacePath;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    private start(): void {
        if (this.disposed) { return; }

        // Production: bundled at extensionPath/backend/src
        // Development (F5): backend lives two levels up at ../../backend/src
        const bundled = path.join(this.extensionPath, 'backend', 'src');
        const devPath = path.join(this.extensionPath, '..', '..', 'backend', 'src');
        const backendSrc = fs.existsSync(bundled) ? bundled : devPath;
        const env = {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONPATH: process.env.PYTHONPATH
                ? `${backendSrc}${path.delimiter}${process.env.PYTHONPATH}`
                : backendSrc,
        };

        this.proc = spawn(this.pythonPath, ['-m', 'clear_query.messaging'], {
            cwd: path.dirname(this.workspacePath),
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.buffer = '';
        this.setStatus('starting');

        this.proc.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
        this.proc.stderr?.on('data', (chunk: Buffer) => {
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

    private onData(chunk: Buffer): void {
        this.buffer += chunk.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) { continue; }
            try {
                const resp = JSON.parse(trimmed) as BackendResponse;
                this.dispatch(resp);
            } catch {
                // non-JSON output — ignore
            }
        }
    }

    private dispatch(resp: BackendResponse): void {
        // First response received — backend is ready
        if (this._status === 'starting') {
            this.setStatus('ready');
            this.restartCount = 0;
        }

        const entry = this.pending.get(resp.id);
        if (!entry) { return; }

        clearTimeout(entry.timer);
        this.pending.delete(resp.id);

        if (resp.success) {
            entry.resolve(resp.data);
        } else {
            entry.reject(new BackendError(resp.error ?? 'Unknown backend error'));
        }
    }

    private onExit(code: number | null): void {
        this.rejectAll(new BackendError('Backend process exited unexpectedly'));

        if (this.restartCount < this.maxRestarts) {
            this.restartCount++;
            this.setStatus('starting');
            setTimeout(() => this.start(), 2000);
        } else {
            this.setStatus('error');
            vscode.window
                .showErrorMessage(
                    `ClearQuery backend crashed after ${this.maxRestarts} restart attempts (exit code ${code}).`,
                    'Restart',
                )
                .then(choice => {
                    if (choice === 'Restart') {
                        this.restartCount = 0;
                        this.start();
                    }
                });
        }
    }

    private setStatus(s: BackendStatus): void {
        this._status = s;
        this._statusEmitter.fire(s);
    }

    private rejectAll(err: Error): void {
        for (const [, entry] of this.pending) {
            clearTimeout(entry.timer);
            entry.reject(err);
        }
        this.pending.clear();
    }

    // ── Public API ───────────────────────────────────────────────────────────

    send<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (!this.proc?.stdin) {
                reject(new BackendError('Backend process not running'));
                return;
            }

            const id = String(this.nextId++);

            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new BackendError(`Request "${command}" timed out after 30s`));
            }, 30_000);

            this.pending.set(id, {
                resolve: resolve as (v: unknown) => void,
                reject,
                timer,
            });

            const req: BackendRequest = { id, command, args };
            this.proc.stdin.write(JSON.stringify(req) + '\n');
        });
    }

    dispose(): void {
        this.disposed = true;
        this.rejectAll(new BackendError('Backend client disposed'));
        this.setStatus('stopped');
        try { this.proc?.kill('SIGTERM'); } catch { /* ignore */ }
        this._statusEmitter.dispose();
    }
}
