from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pandas as pd

from clear_query.datasets.materialize import load_source_dataframe
from clear_query.datasets.parquet_store import write_parquet, ParquetWriteInput, read_parquet, ParquetReadInput
from clear_query.recipes.engine import run_recipe
from clear_query.mariadb.temp_tables import MariaDBConnection
from clear_query.mariadb.type_mapping import dataframe_to_mariadb_schema
from datetime import datetime
import shutil
from clear_query.workspace.modifier import (
    add_recipe_step,
    add_source,
    remove_recipe_step,
    remove_source,
    update_recipe_step,
)
from clear_query.workspace.loader import load_workspace
from clear_query.workspace.types import Source
from clear_query.datasets.loaders.mariadb_loader import MariaDBLoaderInput, mariadb_loader


def _model_dump(obj: Any) -> Any:
    if hasattr(obj, "model_dump"):
        return obj.model_dump(exclude_none=True)
    if hasattr(obj, "dict"):
        return obj.dict(exclude_none=True)
    return obj


def _json_safe_value(value: Any) -> Any:
    if value is None:
        return None

    # pandas NA/NaT/NaN handling
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass

    # numpy / pandas scalars
    if hasattr(value, "item") and callable(value.item):
        try:
            value = value.item()
        except Exception:
            pass

    if isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, Path):
        return str(value)

    if isinstance(value, dict):
        return {str(k): _json_safe_value(v) for k, v in value.items()}

    if isinstance(value, (list, tuple)):
        return [_json_safe_value(v) for v in value]

    return str(value)


def _df_preview(df: pd.DataFrame, limit: int) -> dict[str, Any]:
    columns = [str(c) for c in df.columns.tolist()]
    dtypes = {str(c): str(df[c].dtype) for c in df.columns}
    if limit <= 0:
        return {"columns": columns, "dtypes": dtypes, "rows": []}
    head = df.head(limit)
    rows = [[_json_safe_value(v) for v in row] for row in head.to_numpy().tolist()]
    return {"columns": columns, "dtypes": dtypes, "rows": rows}


def handle_load_workspace(args: dict[str, Any]) -> dict[str, Any]:
    workspace_path = args.get("workspace_path")
    if not workspace_path:
        raise ValueError("Missing required arg: workspace_path")

    ws = load_workspace(workspace_path)
    return _workspace_payload(ws)


def handle_get_preview(args: dict[str, Any]) -> dict[str, Any]:
    workspace_path = args.get("workspace_path")
    source_name = args.get("source_name")
    limit = args.get("limit", 100)

    if not workspace_path:
        raise ValueError("Missing required arg: workspace_path")
    if not source_name:
        raise ValueError("Missing required arg: source_name")

    try:
        limit_int = int(limit)
    except Exception as exc:
        raise ValueError("Invalid arg: limit must be an integer") from exc

    ws = load_workspace(workspace_path)
    source = next((s for s in ws.sources if s.name == source_name), None)
    if source is None:
        raise ValueError(f"Unknown source_name: {source_name}")

    workspace_dir = Path(workspace_path).parent
    df = load_source_dataframe(source, base_dir=workspace_dir)

    if getattr(source, "recipe", None) is not None and getattr(source.recipe, "operations", None):
        if len(source.recipe.operations) > 0:
            df = run_recipe(df, source.recipe)

    return _df_preview(df, limit_int)


def _apply_limit_to_select_query(query: str, limit: int) -> str:
    q = query.strip()
    if q.endswith(";"):
        q = q[:-1].rstrip()
    if limit <= 0:
        return q
    lower = q.lower()
    if lower.startswith("select") and " limit " not in lower:
        return f"{q} LIMIT {limit}"
    return q


def handle_sql_preview(args: dict[str, Any]) -> dict[str, Any]:
    conn = _require_arg(args, "connection")
    query = _require_arg(args, "query")
    limit = args.get("limit", 100)

    if not isinstance(conn, dict):
        raise ValueError("Invalid arg: connection must be an object")

    try:
        limit_int = int(limit)
    except Exception as exc:
        raise ValueError("Invalid arg: limit must be an integer") from exc

    query_str = str(query)
    if limit_int > 0:
        query_str = _apply_limit_to_select_query(query_str, limit_int)

    config = MariaDBLoaderInput(
        host=str(_require_arg(conn, "host")),
        port=int(_require_arg(conn, "port")),
        user=str(_require_arg(conn, "user")),
        password=str(_require_arg(conn, "password")),
        database=str(_require_arg(conn, "database")),
        query=query_str,
    )
    df = mariadb_loader(config)
    return _df_preview(df, limit_int)


def handle_get_sources_schema(args: dict[str, Any]) -> dict[str, Any]:
    workspace_path = _require_arg(args, "workspace_path")

    ws = load_workspace(workspace_path)
    workspace_dir = Path(workspace_path).parent
    artifacts_dir = workspace_dir / "artifacts"

    sources_out: list[dict[str, Any]] = []
    for source in ws.sources:
        src_payload: dict[str, Any] = {
            "name": source.name,
            "type": source.type,
        }

        # Check if parquet artifact exists
        artifact_path = artifacts_dir / f"{source.name}.parquet"
        if artifact_path.exists():
            try:
                from clear_query.datasets.parquet_store import read_parquet, ParquetReadInput
                config = ParquetReadInput(file_path=artifact_path)
                df = read_parquet(config)
                cols = [{"name": str(c), "dtype": str(df[c].dtype)} for c in df.columns]
                src_payload["columns"] = cols
                src_payload["schema_source"] = "parquet_artifact"
            except Exception as exc:
                src_payload["columns"] = []
                src_payload["error"] = str(exc)
                src_payload["schema_source"] = "parquet_artifact"
        else:
            # No artifact available - just return name, no columns
            src_payload["schema_source"] = "none"

        sources_out.append(src_payload)

    return {"sources": sources_out}


def handle_create_workspace(args: dict[str, Any]) -> dict[str, Any]:
    workspace_path = _require_arg(args, "workspace_path")
    name = _require_arg(args, "name")
    overwrite = bool(args.get("overwrite", False))

    # Ticket contract: workspace_path is a folder where workspace.json is created.
    # Backward compatible: if the caller provides a .json file path, use it directly.
    raw_path = Path(str(workspace_path))
    if raw_path.suffix.lower() == ".json":
        ws_path = raw_path
    else:
        ws_path = raw_path / "workspace.json"

    ws_path.parent.mkdir(parents=True, exist_ok=True)
    if ws_path.exists() and not overwrite:
        raise ValueError(f"Workspace file already exists: {ws_path}")

    payload: dict[str, Any] = {"name": str(name), "sources": []}
    ws_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    return _workspace_payload(load_workspace(ws_path))


def _workspace_payload(ws: Any) -> dict[str, Any]:
    sources = [_model_dump(s) for s in ws.sources]
    return {"name": ws.name, "sources": sources}


def _require_arg(args: dict[str, Any], key: str) -> Any:
    if key not in args:
        raise ValueError(f"Missing required arg: {key}")
    value = args.get(key)
    if value is None or value == "":
        raise ValueError(f"Missing required arg: {key}")
    return value


def _infer_set_type_ops(df: pd.DataFrame) -> list[dict[str, Any]]:
    ops: list[dict[str, Any]] = []

    for col in df.columns:
        name = str(col)
        s = df[col]

        dtype: str = "string"

        if pd.api.types.is_integer_dtype(s):
            dtype = "int"
        elif pd.api.types.is_float_dtype(s):
            dtype = "float"
        elif pd.api.types.is_datetime64_any_dtype(s):
            dtype = "datetime"
        elif pd.api.types.is_bool_dtype(s):
            dtype = "string"
        else:
            # Conservative inference for object/string columns:
            # only pick a non-string dtype if conversion would succeed without raising.
            non_null = s.dropna()

            def can_cast_datetime() -> bool:
                try:
                    pd.to_datetime(non_null, errors="raise")
                    return True
                except Exception:
                    return False

            def can_cast_int() -> bool:
                try:
                    pd.to_numeric(non_null, errors="raise").astype("Int64")
                    return True
                except Exception:
                    return False

            def can_cast_float() -> bool:
                try:
                    pd.to_numeric(non_null, errors="raise").astype(float)
                    return True
                except Exception:
                    return False

            # Prefer datetime first, then int, then float, then default to string.
            if len(non_null) > 0 and can_cast_datetime():
                dtype = "datetime"
            elif len(non_null) > 0 and can_cast_int():
                dtype = "int"
            elif len(non_null) > 0 and can_cast_float():
                dtype = "float"
            else:
                dtype = "string"

        ops.append({"type": "set_type", "column": name, "dtype": dtype})

    return ops


def _should_auto_infer_types(source_data: dict[str, Any]) -> bool:
    recipe = source_data.get("recipe")
    if recipe is None:
        return True
    if isinstance(recipe, list):
        return len(recipe) == 0
    if isinstance(recipe, dict):
        ops = recipe.get("operations", [])
        return isinstance(ops, list) and len(ops) == 0
    return False


def handle_add_source(args: dict[str, Any]) -> dict[str, Any]:
    workspace_path = _require_arg(args, "workspace_path")
    source_data = _require_arg(args, "source")
    if not isinstance(source_data, dict):
        raise ValueError("Invalid arg: source must be an object")

    # Auto-infer types for file-based sources when the caller didn't specify a recipe.
    # Conservative behavior:
    # - only runs for csv/xlsx
    # - only runs if the source file exists
    # - only runs when the incoming recipe is empty/missing
    mutated_source = dict(source_data)

    # Normalize recipe format: convert list to dict with operations key
    recipe = mutated_source.get("recipe")
    if isinstance(recipe, list):
        mutated_source["recipe"] = {"operations": recipe}

    if _should_auto_infer_types(mutated_source):
        try:
            candidate = Source.model_validate(mutated_source) if hasattr(Source, "model_validate") else Source.parse_obj(mutated_source)
            if candidate.type in {"csv", "xlsx"} and candidate.path:
                base_dir = Path(workspace_path).parent
                file_path = (base_dir / Path(candidate.path)).resolve() if not Path(candidate.path).is_absolute() else Path(candidate.path)
                if file_path.exists():
                    df = load_source_dataframe(candidate, base_dir=base_dir)
                    type_ops = _infer_set_type_ops(df)
                    mutated_source["recipe"] = {"operations": type_ops}
        except Exception as exc:
            raise ValueError(f"Failed to auto-infer types for source: {exc}") from exc

    add_source(workspace_path, mutated_source)
    return _workspace_payload(load_workspace(workspace_path))


def handle_remove_source(args: dict[str, Any]) -> dict[str, Any]:
    workspace_path = _require_arg(args, "workspace_path")
    source_name = _require_arg(args, "source_name")

    remove_source(workspace_path, str(source_name))
    return _workspace_payload(load_workspace(workspace_path))


def handle_add_recipe_step(args: dict[str, Any]) -> dict[str, Any]:
    workspace_path = _require_arg(args, "workspace_path")
    source_name = _require_arg(args, "source_name")
    step = _require_arg(args, "step")
    if not isinstance(step, dict):
        raise ValueError("Invalid arg: step must be an object")

    add_recipe_step(workspace_path, str(source_name), dict(step))
    return _workspace_payload(load_workspace(workspace_path))


def handle_update_recipe_step(args: dict[str, Any]) -> dict[str, Any]:
    workspace_path = _require_arg(args, "workspace_path")
    source_name = _require_arg(args, "source_name")
    step_index = _require_arg(args, "step_index")
    step = _require_arg(args, "step")
    if not isinstance(step, dict):
        raise ValueError("Invalid arg: step must be an object")
    try:
        idx = int(step_index)
    except Exception as exc:
        raise ValueError("Invalid arg: step_index must be an integer") from exc

    update_recipe_step(workspace_path, str(source_name), idx, dict(step))
    return _workspace_payload(load_workspace(workspace_path))


def handle_remove_recipe_step(args: dict[str, Any]) -> dict[str, Any]:
    workspace_path = _require_arg(args, "workspace_path")
    source_name = _require_arg(args, "source_name")
    step_index = _require_arg(args, "step_index")
    try:
        idx = int(step_index)
    except Exception as exc:
        raise ValueError("Invalid arg: step_index must be an integer") from exc

    remove_recipe_step(workspace_path, str(source_name), idx)
    return _workspace_payload(load_workspace(workspace_path))


def handle_list_source_recipe(args: dict[str, Any]) -> dict[str, Any]:
    workspace_path = _require_arg(args, "workspace_path")
    source_name = _require_arg(args, "source_name")

    ws = load_workspace(workspace_path)
    source = next((s for s in ws.sources if s.name == source_name), None)
    if source is None:
        raise ValueError(f"Unknown source_name: {source_name}")

    recipe = getattr(source, "recipe", None)
    operations = []
    if recipe is not None and hasattr(recipe, "operations"):
        operations = [_model_dump(op) for op in recipe.operations]

    return {"source_name": source_name, "operations": operations}


def handle_sync_sources_to_temp_tables(args: dict[str, Any]) -> dict[str, Any]:
    workspace_path = _require_arg(args, "workspace_path")
    connection = _require_arg(args, "connection")
    if not isinstance(connection, dict):
        raise ValueError("Invalid arg: connection must be an object")

    ws = load_workspace(workspace_path)
    workspace_dir = Path(workspace_path).parent
    artifacts_dir = workspace_dir / "artifacts"

    host = str(_require_arg(connection, "host"))
    port = int(_require_arg(connection, "port"))
    user = str(_require_arg(connection, "user"))
    password = str(_require_arg(connection, "password"))
    database = str(_require_arg(connection, "database"))

    synced_tables: list[str] = []

    with MariaDBConnection(host=host, port=port, user=user, password=password, database=database) as db:
        for source in ws.sources:
            artifact_path = artifacts_dir / f"{source.name}.parquet"
            if db.sync_source_to_temp_table(source.name, artifact_path):
                synced_tables.append(source.name)

    return {"success": True, "synced_tables": synced_tables}


def handle_export_sql_result(args: dict[str, Any]) -> dict[str, Any]:
    workspace_path = _require_arg(args, "workspace_path")
    query = _require_arg(args, "query")
    connection = _require_arg(args, "connection")
    encoding = args.get("encoding", "utf-8")
    separator = args.get("separator", ";")

    if not isinstance(connection, dict):
        raise ValueError("Invalid arg: connection must be an object")

    # Execute the query
    from clear_query.datasets.loaders.mariadb_loader import MariaDBLoaderInput, mariadb_loader

    config = MariaDBLoaderInput(
        host=str(_require_arg(connection, "host")),
        port=int(_require_arg(connection, "port")),
        user=str(_require_arg(connection, "user")),
        password=str(_require_arg(connection, "password")),
        database=str(_require_arg(connection, "database")),
        query=str(query),
    )
    result_df = mariadb_loader(config)

    # Create export directory with timestamp
    workspace_dir = Path(workspace_path).parent
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    export_dir = workspace_dir / f"export_{timestamp}"
    export_dir.mkdir(parents=True, exist_ok=True)

    # Copy parquet files from artifacts
    artifacts_dir = workspace_dir / "artifacts"
    if artifacts_dir.exists():
        export_artifacts = export_dir / "artifacts"
        shutil.copytree(artifacts_dir, export_artifacts, dirs_exist_ok=True)

    # Save workspace.json (snapshot)
    ws = load_workspace(workspace_path)
    from clear_query.workspace.modifier import save_workspace
    export_workspace = export_dir / "workspace.json"
    save_workspace(export_workspace, ws)

    # Save temp table creation script and insert statements
    export_ddl = export_dir / "create_tables.sql"
    export_insert = export_dir / "insert_data.sql"
    ddl_statements: list[str] = []
    insert_statements: list[str] = []

    with MariaDBConnection(
        host=str(_require_arg(connection, "host")),
        port=int(_require_arg(connection, "port")),
        user=str(_require_arg(connection, "user")),
        password=str(_require_arg(connection, "password")),
        database=str(_require_arg(connection, "database")),
    ) as db:
        for source in ws.sources:
            artifact_path = artifacts_dir / f"{source.name}.parquet"
            try:
                ddl = db.get_create_table_ddl(source.name, artifact_path)
                if ddl:
                    ddl_statements.append(ddl)

                # Generate INSERT statements
                if artifact_path.exists():
                    config = ParquetReadInput(file_path=artifact_path)
                    df = read_parquet(config)
                    schema = dataframe_to_mariadb_schema(df)
                    table_name = source.name

                    # Build column list
                    column_list = ",".join([f"`{col_name}`" for col_name, _ in schema])

                    # Generate INSERT statements for each row
                    for _, row in df.iterrows():
                        values = []
                        for col_name, _ in schema:
                            val = row[col_name]
                            # Handle NULL/NaN
                            if pd.isna(val):
                                values.append("NULL")
                            elif isinstance(val, str):
                                # Escape quotes in strings
                                escaped = val.replace("'", "''")
                                values.append(f"'{escaped}'")
                            elif isinstance(val, (int, float)):
                                values.append(str(val))
                            elif isinstance(val, bool):
                                values.append("1" if val else "0")
                            else:
                                # For datetime and other types, convert to string
                                escaped = str(val).replace("'", "''")
                                values.append(f"'{escaped}'")

                        values_str = ",".join(values)
                        insert_sql = f"INSERT INTO `{table_name}` ({column_list}) VALUES ({values_str});"
                        insert_statements.append(insert_sql)
            except Exception:
                pass

    export_ddl.write_text("\n\n".join(ddl_statements) + "\n", encoding="utf-8")
    export_insert.write_text("\n".join(insert_statements) + "\n", encoding="utf-8")

    # Save the SQL query that was run
    export_sql = export_dir / "query.sql"
    export_sql.write_text(query, encoding="utf-8")

    # Save result as CSV
    export_csv = export_dir / "result.csv"
    result_df.to_csv(export_csv, sep=separator, encoding=encoding, index=False)

    return {
        "success": True,
        "export_path": str(export_dir),
        "rows": len(result_df),
        "columns": list(result_df.columns),
    }


def handle_save_sources_to_parquet(args: dict[str, Any]) -> dict[str, Any]:
    workspace_path = _require_arg(args, "workspace_path")

    ws = load_workspace(workspace_path)
    workspace_dir = Path(workspace_path).parent
    artifacts_dir = workspace_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    saved_files: list[str] = []

    for source in ws.sources:
        try:
            df = load_source_dataframe(source, base_dir=workspace_dir)
            if getattr(source, "recipe", None) is not None and getattr(source.recipe, "operations", None):
                if len(source.recipe.operations) > 0:
                    df = run_recipe(df, source.recipe)

            output_path = artifacts_dir / f"{source.name}.parquet"
            config = ParquetWriteInput(df=df, output_path=output_path)
            write_parquet(config)
            saved_files.append(str(output_path))
        except Exception as exc:
            raise ValueError(f"Failed to save source '{source.name}' to parquet: {exc}") from exc

    return {"success": True, "saved_files": saved_files}


def _dispatch(command: str, args: dict[str, Any]) -> dict[str, Any]:
    if command == "load_workspace":
        return handle_load_workspace(args)
    if command == "get_preview":
        return handle_get_preview(args)
    if command == "sql_preview":
        return handle_sql_preview(args)
    if command == "get_sources_schema":
        return handle_get_sources_schema(args)
    if command == "create_workspace":
        return handle_create_workspace(args)
    if command == "add_source":
        return handle_add_source(args)
    if command == "remove_source":
        return handle_remove_source(args)
    if command == "add_recipe_step":
        return handle_add_recipe_step(args)
    if command == "update_recipe_step":
        return handle_update_recipe_step(args)
    if command == "remove_recipe_step":
        return handle_remove_recipe_step(args)
    if command == "list_source_recipe":
        return handle_list_source_recipe(args)
    if command == "sync_sources_to_temp_tables":
        return handle_sync_sources_to_temp_tables(args)
    if command == "export_sql_result":
        return handle_export_sql_result(args)
    if command == "save_sources_to_parquet":
        return handle_save_sources_to_parquet(args)
    raise ValueError(f"Unknown command: {command}")


def main() -> None:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        req_id: Any = None
        try:
            req = json.loads(line)
            if not isinstance(req, dict):
                raise ValueError("Request must be a JSON object")

            req_id = req.get("id")
            command = req.get("command")
            args = req.get("args", {})

            if req_id is None or req_id == "":
                raise ValueError("Missing required field: id")
            if not command:
                raise ValueError("Missing required field: command")
            if not isinstance(args, dict):
                raise ValueError("Field 'args' must be an object")

            data = _dispatch(str(command), args)
            resp = {"id": req_id, "success": True, "data": _json_safe_value(data)}
        except Exception as exc:
            resp = {"id": req_id, "success": False, "error": str(exc)}

        print(json.dumps(resp, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
