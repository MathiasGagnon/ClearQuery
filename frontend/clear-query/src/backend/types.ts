// ─── Protocol ────────────────────────────────────────────────────────────────

export interface BackendRequest {
    id: string;
    command: string;
    args: Record<string, unknown>;
}

export interface BackendResponse {
    id: string;
    success: boolean;
    data?: unknown;
    error?: string;
}

// ─── Shared sub-types ────────────────────────────────────────────────────────

export interface ColumnInfo {
    name: string;
    dtype: string;
}

export interface SourceInfo {
    name: string;
    type: string;
    columns?: ColumnInfo[];
    schema_source?: 'parquet_artifact' | 'none';
    error?: string;
}

export interface RecipeOperation {
    type: string;
    [key: string]: unknown;
}

export interface Recipe {
    operations: RecipeOperation[];
}

export interface Source {
    name: string;
    type: string;
    path?: string;
    query?: string;
    csv_separator?: string;
    csv_encoding?: string;
    recipe?: Recipe;
}

export interface Connection {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}

// ─── Command payloads ────────────────────────────────────────────────────────

export interface WorkspacePayload {
    name: string;
    sources: Source[];
}

export interface PreviewPayload {
    columns: string[];
    dtypes: Record<string, string>;
    rows: unknown[][];
}

export interface SourcesSchemaPayload {
    sources: SourceInfo[];
}

export interface SavedFilesPayload {
    success: boolean;
    saved_files: string[];
}

export interface SyncedTablesPayload {
    success: boolean;
    synced_tables: string[];
}

export interface ListRecipePayload {
    source_name: string;
    operations: RecipeOperation[];
}

export interface ExportPayload {
    success: boolean;
    export_path: string;
    rows: number;
    columns: string[];
}
