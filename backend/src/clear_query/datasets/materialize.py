from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from clear_query.datasets.loaders.csv_loader import CSVLoaderInput, csv_loader
from clear_query.datasets.loaders.excel_loader import ExcelLoaderInput, excel_loader
from clear_query.datasets.parquet_store import ParquetWriteInput, write_parquet
from clear_query.recipes.engine import run_recipe
from clear_query.recipes.types import Recipe
from clear_query.workspace.loader import load_workspace
from clear_query.workspace.types import Workspace, Source


@dataclass(frozen=True)
class MaterializedSource:
    source: Source
    df: pd.DataFrame
    parquet_path: Path


def _resolve_path(base_dir: Path, maybe_relative: str | Path) -> Path:
    p = Path(maybe_relative)
    return p if p.is_absolute() else (base_dir / p).resolve()


def _apply_recipe_if_any(df: pd.DataFrame, recipe: Recipe | Any | None) -> pd.DataFrame:
    if recipe is None:
        return df

    if isinstance(recipe, Recipe):
        if not recipe.operations:
            return df
        return run_recipe(df, recipe)

    if isinstance(recipe, dict):
        payload = recipe
    elif isinstance(recipe, list):
        payload = {"operations": recipe}
    else:
        raise TypeError(f"Invalid recipe type: {type(recipe).__name__}")

    ops = payload.get("operations", [])
    if not ops:
        return df

    recipe_model = Recipe.model_validate(payload) if hasattr(Recipe, "model_validate") else Recipe.parse_obj(payload)
    return run_recipe(df, recipe_model)


def load_source_dataframe(source: Source, base_dir: Path | None = None) -> pd.DataFrame:
    """
    Load a single source into a DataFrame and apply its recipe (if any).

    Relative source paths are resolved from the workspace JSON's directory.
    """
    if base_dir is None:
        base_dir = Path(source.path).parent if source.path else Path(".")

    if source.type == "csv":
        if not source.path:
            raise ValueError(f"Source '{source.name}' is type=csv but has no path")
        file_path = _resolve_path(base_dir, source.path)
        df = csv_loader(
            CSVLoaderInput(
                file_path=file_path,
                separator=source.csv_separator or ",",
                encoding=source.csv_encoding or "utf-8",
            )
        )
        return df

    if source.type == "xlsx":
        if not source.path:
            raise ValueError(f"Source '{source.name}' is type=xlsx but has no path")
        file_path = _resolve_path(base_dir, source.path)
        df = excel_loader(ExcelLoaderInput(file_path=file_path))
        return df

    if source.type == "sql":
        raise NotImplementedError("SQL sources are not supported yet (needs connection config).")

    raise ValueError(f"Unsupported source type: {source.type}")


def materialize_workspace(
    workspace_path: str | Path,
    source_names: list[str] | None = None,
) -> list[MaterializedSource]:
    """
    Load all project sources (or a subset specified by source_names), apply recipes, and store as parquet.

    Returns:
        MaterializedSource objects in the same order as `project.sources`.
    """
    results: list[MaterializedSource] = []

    workspace = load_workspace(workspace_path)
    workspace_dir = Path(workspace_path).parent

    for source in workspace.sources:
        if source_names is not None and source.name not in source_names:
            continue
        df = load_source_dataframe(source, base_dir=workspace_dir)
        df = _apply_recipe_if_any(df, source.recipe)
        if source.output_path is None: raise ValueError(f"Source '{source.name}' has no output_path defined for materialization.")
        written = write_parquet(ParquetWriteInput(df=df, output_path=source.output_path))
        results.append(MaterializedSource(source=source, df=df, parquet_path=written))

    return results
