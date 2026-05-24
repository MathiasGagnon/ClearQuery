from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pandas as pd

from clear_query.datasets.materialize import load_source_dataframe
from clear_query.recipes.engine import run_recipe
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

        if pd.api.types.is_bool_dtype(s):
            dtype = "boolean"
        elif pd.api.types.is_integer_dtype(s):
            dtype = "int"
        elif pd.api.types.is_float_dtype(s):
            dtype = "float"
        elif pd.api.types.is_datetime64_any_dtype(s):
            dtype = "datetime"
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

            def can_cast_bool() -> bool:
                if len(non_null) == 0:
                    return False
                normalized = {str(v).strip().lower() for v in non_null.tolist()}
                return normalized.issubset({"0", "1", "true", "false", "yes", "no"})

            # Prefer datetime first for typical CSV usage, then numeric, then boolean.
            if len(non_null) > 0 and can_cast_datetime():
                dtype = "datetime"
            elif len(non_null) > 0 and can_cast_int():
                dtype = "int"
            elif len(non_null) > 0 and can_cast_float():
                dtype = "float"
            elif can_cast_bool():
                dtype = "boolean"
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
    try:
        if _should_auto_infer_types(mutated_source):
            candidate = Source.model_validate(mutated_source) if hasattr(Source, "model_validate") else Source.parse_obj(mutated_source)
            if candidate.type in {"csv", "xlsx"} and candidate.path:
                base_dir = Path(workspace_path).parent
                file_path = (base_dir / Path(candidate.path)).resolve() if not Path(candidate.path).is_absolute() else Path(candidate.path)
                if file_path.exists():
                    df = load_source_dataframe(candidate, base_dir=base_dir)
                    type_ops = _infer_set_type_ops(df)
                    mutated_source["recipe"] = {"operations": type_ops}
    except Exception:
        # Never block add_source on type inference; fallback to original payload.
        mutated_source = dict(source_data)

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


def _dispatch(command: str, args: dict[str, Any]) -> dict[str, Any]:
    if command == "load_workspace":
        return handle_load_workspace(args)
    if command == "get_preview":
        return handle_get_preview(args)
    if command == "sql_preview":
        return handle_sql_preview(args)
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
