# src/query_platform/recipes/types.py

from pydantic import BaseModel
from typing import Union, Literal, Any


# -------------------------
# Base Operation
# -------------------------

class FilterRows(BaseModel):
    type: Literal["filter_rows"]
    column: str
    operator: Literal["==", "!=", ">", "<", ">=", "<="]
    value: Any


class RenameColumn(BaseModel):
    type: Literal["rename_column"]
    old_name: str
    new_name: str


class Unique(BaseModel):
    type: Literal["unique"]
    column: str | None = None


class Sort(BaseModel):
    type: Literal["sort"]
    column: str
    ascending: bool = True


class SetType(BaseModel):
    type: Literal["set_type"]
    column: str
    dtype: Literal["string", "int", "float", "datetime", "boolean"]


class ComputedColumn(BaseModel):
    type: Literal["computed_column"]
    name: str
    expression: str


class ReplaceValue(BaseModel):
    type: Literal["replace_value"]
    column: str
    value: Any
    replacement: Any


# -------------------------
# UNION OF ALL OPERATIONS
# -------------------------

RecipeOperation = Union[
    FilterRows,
    RenameColumn,
    Unique,
    Sort,
    SetType,
    ComputedColumn,
    ReplaceValue,
]


# -------------------------
# FULL RECIPE
# -------------------------

class Recipe(BaseModel):
    operations: list[RecipeOperation]
