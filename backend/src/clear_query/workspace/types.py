from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from clear_query.recipes.types import Recipe

class MaterializedTable(BaseModel):
    name: str
    database: str
    db_schema: str | None = None

class Source(BaseModel):
    name: str
    type: Literal["csv", "xlsx", "sql"]
    path: str | None = None
    query: str | None = None
    csv_separator: str | None = None
    csv_encoding: str | None = None
    recipe: Recipe = Field(default_factory=lambda: Recipe(operations=[]))
    output_table: MaterializedTable | None = None
    output_path: Path | None = None

class Workspace(BaseModel):
    name: str
    sources: list[Source]
