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
exports.WorkspaceTreeProvider = exports.AddSourceNode = exports.RecipeStepNode = exports.SourceNode = exports.WorkspaceNode = void 0;
const vscode = __importStar(require("vscode"));
const workspace_1 = require("../commands/workspace");
const workspace_2 = require("../commands/workspace");
class WorkspaceNode extends vscode.TreeItem {
    kind = 'workspace';
    constructor(name) {
        super(name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'workspace';
        this.iconPath = new vscode.ThemeIcon('folder-opened');
    }
}
exports.WorkspaceNode = WorkspaceNode;
class SourceNode extends vscode.TreeItem {
    info;
    kind = 'source';
    constructor(info) {
        super(info.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.info = info;
        this.contextValue = 'source';
        const synced = info.schema_source === 'parquet_artifact';
        this.description = `[${info.type}]${synced ? '' : '  ⚠ sync needed'}`;
        this.iconPath = new vscode.ThemeIcon('database', new vscode.ThemeColor(synced ? 'testing.iconPassed' : 'testing.iconQueued'));
        this.tooltip = synced
            ? `${info.name} [${info.type}] — artifact synced`
            : `${info.name} [${info.type}] — no artifact, sync needed`;
    }
}
exports.SourceNode = SourceNode;
class RecipeStepNode extends vscode.TreeItem {
    sourceName;
    stepIndex;
    operation;
    kind = 'recipeStep';
    constructor(sourceName, stepIndex, operation) {
        super(RecipeStepNode.formatLabel(operation), vscode.TreeItemCollapsibleState.None);
        this.sourceName = sourceName;
        this.stepIndex = stepIndex;
        this.operation = operation;
        this.contextValue = 'recipeStep';
        this.description = `step ${stepIndex + 1}`;
        this.iconPath = new vscode.ThemeIcon('symbol-operator');
    }
    static formatLabel(op) {
        switch (op.type) {
            case 'set_type':
                return `set_type: ${String(op['column'])} → ${String(op['dtype'])}`;
            case 'filter_rows':
                return `filter: ${String(op['column'])} ${String(op['operator'])} ${String(op['value'])}`;
            case 'rename_column':
                return `rename: ${String(op['old_name'])} → ${String(op['new_name'])}`;
            case 'unique':
                return op['column'] ? `unique: ${String(op['column'])}` : 'unique (all columns)';
            case 'sort':
                return `sort: ${String(op['column'])} ${op['ascending'] !== false ? '↑' : '↓'}`;
            case 'computed_column':
                return `computed: ${String(op['name'])} = ${String(op['expression'])}`;
            case 'replace_value':
                return `replace: ${String(op['column'])}: ${String(op['value'])} → ${String(op['replacement'])}`;
            default:
                return op.type;
        }
    }
}
exports.RecipeStepNode = RecipeStepNode;
class AddSourceNode extends vscode.TreeItem {
    kind = 'addSource';
    constructor() {
        super('＋ Add source…', vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'addSource';
        this.iconPath = new vscode.ThemeIcon('add');
        this.command = { command: 'clearquery.addSource', title: 'Add Source' };
    }
}
exports.AddSourceNode = AddSourceNode;
// ─── Provider ────────────────────────────────────────────────────────────────
class WorkspaceTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    sources = [];
    _subs = [];
    constructor() {
        this._subs.push(workspace_2.onDidChangeClient.event(client => {
            if (client) {
                void this.refresh();
            }
            else {
                this.sources = [];
                this._onDidChangeTreeData.fire();
            }
        }));
    }
    // ── Public ───────────────────────────────────────────────────────────────
    async refresh() {
        const client = (0, workspace_1.getClient)();
        if (!client) {
            this.sources = [];
            this._onDidChangeTreeData.fire();
            return;
        }
        try {
            const schema = await client.send('get_sources_schema', {
                workspace_path: client.path,
            });
            this.sources = schema.sources;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`ClearQuery: failed to load sources — ${msg}`);
        }
        this._onDidChangeTreeData.fire();
    }
    // ── TreeDataProvider ─────────────────────────────────────────────────────
    getTreeItem(node) {
        return node;
    }
    getChildren(node) {
        const client = (0, workspace_1.getClient)();
        if (!client) {
            return [];
        }
        if (!node) {
            return [new WorkspaceNode((0, workspace_1.getWorkspaceName)() || 'Workspace')];
        }
        switch (node.kind) {
            case 'workspace':
                return [
                    ...this.sources.map(s => new SourceNode(s)),
                    new AddSourceNode(),
                ];
            case 'source':
                return this.fetchRecipeSteps(node);
            default:
                return [];
        }
    }
    async fetchRecipeSteps(node) {
        const client = (0, workspace_1.getClient)();
        if (!client) {
            return [];
        }
        try {
            const recipe = await client.send('list_source_recipe', {
                workspace_path: client.path,
                source_name: node.info.name,
            });
            return recipe.operations.map((op, i) => new RecipeStepNode(node.info.name, i, op));
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`ClearQuery: failed to load recipe for "${node.info.name}" — ${msg}`);
            return [];
        }
    }
    // ── Dispose ──────────────────────────────────────────────────────────────
    dispose() {
        this._subs.forEach(d => d.dispose());
        this._onDidChangeTreeData.dispose();
    }
}
exports.WorkspaceTreeProvider = WorkspaceTreeProvider;
//# sourceMappingURL=workspaceTree.js.map