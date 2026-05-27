import * as vscode from 'vscode';
import { getClient, getWorkspaceName } from '../commands/workspace';
import { onDidChangeClient } from '../commands/workspace';
import { SourceInfo, SourcesSchemaPayload, ListRecipePayload, RecipeOperation } from '../backend/types';

// ─── Node types ──────────────────────────────────────────────────────────────

export type TreeNode = WorkspaceNode | SourceNode | RecipeStepNode | AddSourceNode;

export class WorkspaceNode extends vscode.TreeItem {
    readonly kind = 'workspace' as const;
    constructor(name: string) {
        super(name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'workspace';
        this.iconPath = new vscode.ThemeIcon('folder-opened');
    }
}

export class SourceNode extends vscode.TreeItem {
    readonly kind = 'source' as const;
    constructor(public readonly info: SourceInfo) {
        super(info.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'source';

        const synced = info.schema_source === 'parquet_artifact';
        this.description = `[${info.type}]${synced ? '' : '  ⚠ sync needed'}`;
        this.iconPath = new vscode.ThemeIcon(
            'database',
            new vscode.ThemeColor(synced ? 'testing.iconPassed' : 'testing.iconQueued'),
        );
        this.tooltip = synced
            ? `${info.name} [${info.type}] — artifact synced`
            : `${info.name} [${info.type}] — no artifact, sync needed`;
    }
}

export class RecipeStepNode extends vscode.TreeItem {
    readonly kind = 'recipeStep' as const;
    constructor(
        public readonly sourceName: string,
        public readonly stepIndex: number,
        public readonly operation: RecipeOperation,
    ) {
        super(RecipeStepNode.formatLabel(operation), vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'recipeStep';
        this.description = `step ${stepIndex + 1}`;
        this.iconPath = new vscode.ThemeIcon('symbol-operator');
    }

    private static formatLabel(op: RecipeOperation): string {
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

export class AddSourceNode extends vscode.TreeItem {
    readonly kind = 'addSource' as const;
    constructor() {
        super('＋ Add source…', vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'addSource';
        this.iconPath = new vscode.ThemeIcon('add');
        this.command = { command: 'clearquery.addSource', title: 'Add Source' };
    }
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class WorkspaceTreeProvider
    implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {

    private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private sources: SourceInfo[] = [];
    private readonly _subs: vscode.Disposable[] = [];

    constructor() {
        this._subs.push(
            onDidChangeClient.event(client => {
                if (client) {
                    void this.refresh();
                } else {
                    this.sources = [];
                    this._onDidChangeTreeData.fire();
                }
            }),
        );
    }

    // ── Public ───────────────────────────────────────────────────────────────

    async refresh(): Promise<void> {
        const client = getClient();
        if (!client) {
            this.sources = [];
            this._onDidChangeTreeData.fire();
            return;
        }

        try {
            const schema = await client.send<SourcesSchemaPayload>('get_sources_schema', {
                workspace_path: client.path,
            });
            this.sources = schema.sources;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`ClearQuery: failed to load sources — ${msg}`);
        }

        this._onDidChangeTreeData.fire();
    }

    // ── TreeDataProvider ─────────────────────────────────────────────────────

    getTreeItem(node: TreeNode): vscode.TreeItem {
        return node;
    }

    getChildren(node?: TreeNode): vscode.ProviderResult<TreeNode[]> {
        const client = getClient();
        if (!client) { return []; }

        if (!node) {
            return [new WorkspaceNode(getWorkspaceName() || 'Workspace')];
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

    private async fetchRecipeSteps(node: SourceNode): Promise<TreeNode[]> {
        const client = getClient();
        if (!client) { return []; }

        try {
            const recipe = await client.send<ListRecipePayload>('list_source_recipe', {
                workspace_path: client.path,
                source_name: node.info.name,
            });
            return recipe.operations.map((op, i) => new RecipeStepNode(node.info.name, i, op));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(
                `ClearQuery: failed to load recipe for "${node.info.name}" — ${msg}`,
            );
            return [];
        }
    }

    // ── Dispose ──────────────────────────────────────────────────────────────

    dispose(): void {
        this._subs.forEach(d => d.dispose());
        this._onDidChangeTreeData.dispose();
    }
}
