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
exports.initRecipeCommands = initRecipeCommands;
const vscode = __importStar(require("vscode"));
const workspace_1 = require("./workspace");
function initRecipeCommands(context, tree) {
    context.subscriptions.push(vscode.commands.registerCommand('clearquery.removeRecipeStep', (node) => removeRecipeStep(node, tree)), vscode.commands.registerCommand('clearquery.addRecipeStep', (node) => addRecipeStep(node, tree)), vscode.commands.registerCommand('clearquery.editRecipeStep', (node) => editRecipeStep(node, tree)));
}
// ─── Remove ───────────────────────────────────────────────────────────────────
async function removeRecipeStep(node, tree) {
    let client;
    try {
        client = (0, workspace_1.requireClient)();
    }
    catch (err) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        return;
    }
    try {
        await client.send('remove_recipe_step', {
            workspace_path: client.path,
            source_name: node.sourceName,
            step_index: node.stepIndex,
        });
        await tree.refresh();
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ClearQuery: failed to remove recipe step — ${msg}`);
    }
}
// ─── Add ──────────────────────────────────────────────────────────────────────
async function addRecipeStep(node, tree) {
    let client;
    try {
        client = (0, workspace_1.requireClient)();
    }
    catch (err) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        return;
    }
    const opType = await pickOperationType();
    if (!opType) {
        return;
    }
    const step = await buildStep(opType, node.info.columns);
    if (!step) {
        return;
    }
    try {
        await client.send('add_recipe_step', {
            workspace_path: client.path,
            source_name: node.info.name,
            step,
        });
        await tree.refresh();
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ClearQuery: failed to add step — ${msg}`);
    }
}
// ─── Edit ─────────────────────────────────────────────────────────────────────
async function editRecipeStep(node, tree) {
    let client;
    try {
        client = (0, workspace_1.requireClient)();
    }
    catch (err) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        return;
    }
    // Fetch current columns for the source so pickers are useful
    const columns = await fetchColumns(node.sourceName);
    const step = await buildStep(node.operation.type, columns, node.operation);
    if (!step) {
        return;
    }
    try {
        await client.send('update_recipe_step', {
            workspace_path: client.path,
            source_name: node.sourceName,
            step_index: node.stepIndex,
            step,
        });
        await tree.refresh();
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ClearQuery: failed to update step — ${msg}`);
    }
}
// ─── Step builders ────────────────────────────────────────────────────────────
async function buildStep(opType, columns, current) {
    switch (opType) {
        case 'set_type': return buildSetType(columns, current);
        case 'filter_rows': return buildFilterRows(columns, current);
        case 'rename_column': return buildRenameColumn(columns, current);
        case 'unique': return buildUnique(columns, current);
        case 'sort': return buildSort(columns, current);
        case 'computed_column': return buildComputedColumn(current);
        case 'replace_value': return buildReplaceValue(columns, current);
        default: return undefined;
    }
}
// set_type ────────────────────────────────────────────────────────────────────
async function buildSetType(columns, current) {
    const cur = current?.type === 'set_type' ? current : undefined;
    const col = await pickColumn('Column to retype', columns, cur?.['column']);
    if (!col) {
        return undefined;
    }
    const dtype = await vscode.window.showQuickPick([
        { label: 'string', description: 'Text / varchar' },
        { label: 'int', description: 'Integer (Int64)' },
        { label: 'float', description: 'Floating-point number' },
        { label: 'datetime', description: 'Date and time' },
        { label: 'boolean', description: 'True / False' },
    ], { title: 'Target dtype', placeHolder: cur ? `Current: ${cur['dtype']}` : 'Pick data type' });
    if (!dtype) {
        return undefined;
    }
    return { type: 'set_type', column: col, dtype: dtype.label };
}
// filter_rows ─────────────────────────────────────────────────────────────────
async function buildFilterRows(columns, current) {
    const cur = current?.type === 'filter_rows' ? current : undefined;
    const col = await pickColumn('Column to filter on', columns, cur?.['column']);
    if (!col) {
        return undefined;
    }
    const opChoice = await vscode.window.showQuickPick(['==', '!=', '>', '<', '>=', '<='].map(o => ({ label: o })), { title: 'Comparison operator', placeHolder: cur ? `Current: ${cur['operator']}` : undefined });
    if (!opChoice) {
        return undefined;
    }
    const value = await vscode.window.showInputBox({
        title: 'Filter value',
        value: cur ? String(cur['value']) : '',
        placeHolder: 'e.g.  42  or  "active"',
        validateInput: v => v.trim() !== '' ? undefined : 'Value cannot be empty',
    });
    if (value === undefined) {
        return undefined;
    }
    // Try to parse as number; keep as string otherwise
    const parsed = Number(value);
    const finalValue = isNaN(parsed) ? value : parsed;
    return { type: 'filter_rows', column: col, operator: opChoice.label, value: finalValue };
}
// rename_column ───────────────────────────────────────────────────────────────
async function buildRenameColumn(columns, current) {
    const cur = current?.type === 'rename_column' ? current : undefined;
    const oldName = await pickColumn('Column to rename', columns, cur?.['old_name']);
    if (!oldName) {
        return undefined;
    }
    const newName = await vscode.window.showInputBox({
        title: 'New column name',
        value: cur ? String(cur['new_name']) : '',
        validateInput: v => v.trim() ? undefined : 'Name cannot be empty',
    });
    if (!newName) {
        return undefined;
    }
    return { type: 'rename_column', old_name: oldName, new_name: newName.trim() };
}
// unique ──────────────────────────────────────────────────────────────────────
async function buildUnique(columns, current) {
    const cur = current?.type === 'unique' ? current : undefined;
    const scope = await vscode.window.showQuickPick([
        { label: 'All columns', description: 'Keep rows unique across all columns', value: '' },
        { label: 'Single column', description: 'Keep rows unique by one column', value: 'single' },
    ], {
        title: 'Unique scope',
        placeHolder: cur?.['column'] ? `Current: ${cur['column']}` : 'All columns',
    });
    if (!scope) {
        return undefined;
    }
    if (scope.value === '') {
        return { type: 'unique' };
    }
    const col = await pickColumn('Column for unique', columns, cur?.['column']);
    if (!col) {
        return undefined;
    }
    return { type: 'unique', column: col };
}
// sort ────────────────────────────────────────────────────────────────────────
async function buildSort(columns, current) {
    const cur = current?.type === 'sort' ? current : undefined;
    const col = await pickColumn('Column to sort by', columns, cur?.['column']);
    if (!col) {
        return undefined;
    }
    const dir = await vscode.window.showQuickPick([
        { label: '↑ Ascending', value: true },
        { label: '↓ Descending', value: false },
    ], {
        title: 'Sort direction',
        placeHolder: cur ? `Current: ${cur['ascending'] !== false ? 'Ascending' : 'Descending'}` : undefined,
    });
    if (!dir) {
        return undefined;
    }
    return { type: 'sort', column: col, ascending: dir.value };
}
// computed_column ─────────────────────────────────────────────────────────────
async function buildComputedColumn(current) {
    const cur = current?.type === 'computed_column' ? current : undefined;
    const name = await vscode.window.showInputBox({
        title: 'New column name',
        value: cur ? String(cur['name']) : '',
        validateInput: v => v.trim() ? undefined : 'Name cannot be empty',
    });
    if (!name) {
        return undefined;
    }
    const expression = await vscode.window.showInputBox({
        title: 'Expression',
        value: cur ? String(cur['expression']) : '',
        placeHolder: "e.g.  df['price'] * df['qty']",
        prompt: "Python / pandas expression. Use df['column'] to reference columns.",
        validateInput: v => v.trim() ? undefined : 'Expression cannot be empty',
    });
    if (!expression) {
        return undefined;
    }
    return { type: 'computed_column', name: name.trim(), expression: expression.trim() };
}
// replace_value ───────────────────────────────────────────────────────────────
async function buildReplaceValue(columns, current) {
    const cur = current?.type === 'replace_value' ? current : undefined;
    const col = await pickColumn('Column', columns, cur?.['column']);
    if (!col) {
        return undefined;
    }
    const oldVal = await vscode.window.showInputBox({
        title: 'Value to replace',
        value: cur ? String(cur['value']) : '',
        placeHolder: 'e.g.  N/A  or  0',
        validateInput: v => v.trim() !== '' ? undefined : 'Value cannot be empty',
    });
    if (oldVal === undefined) {
        return undefined;
    }
    const newVal = await vscode.window.showInputBox({
        title: 'Replacement value',
        value: cur ? String(cur['replacement']) : '',
        placeHolder: 'e.g.  Unknown  or  null',
    });
    if (newVal === undefined) {
        return undefined;
    }
    const parseVal = (s) => { const n = Number(s); return isNaN(n) ? s : n; };
    return { type: 'replace_value', column: col, value: parseVal(oldVal), replacement: parseVal(newVal) };
}
// ─── Shared helpers ───────────────────────────────────────────────────────────
async function pickOperationType() {
    const choice = await vscode.window.showQuickPick([
        { label: 'set_type', description: 'Change a column\'s data type' },
        { label: 'filter_rows', description: 'Keep only rows matching a condition' },
        { label: 'rename_column', description: 'Rename a column' },
        { label: 'unique', description: 'Remove duplicate rows' },
        { label: 'sort', description: 'Sort rows by a column' },
        { label: 'computed_column', description: 'Add a new column from an expression' },
        { label: 'replace_value', description: 'Replace a specific value in a column' },
    ], { title: 'Add Recipe Step', placeHolder: 'Select operation type' });
    return choice?.label;
}
async function pickColumn(title, columns, current) {
    if (columns?.length) {
        const items = columns.map(c => ({
            label: c.name,
            description: c.dtype,
        }));
        const picked = await vscode.window.showQuickPick(items, {
            title,
            placeHolder: current ? `Current: ${current}` : 'Select a column',
        });
        return picked?.label;
    }
    return vscode.window.showInputBox({
        title,
        value: current ?? '',
        validateInput: v => v.trim() ? undefined : 'Column name cannot be empty',
    });
}
async function fetchColumns(sourceName) {
    const client = (0, workspace_1.getClient)();
    if (!client) {
        return undefined;
    }
    try {
        const schema = await client.send('get_sources_schema', {
            workspace_path: client.path,
        });
        return schema.sources.find(s => s.name === sourceName)?.columns;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=recipe.js.map