import pandas as pd
import pytest

from clear_query.recipes.engine import run_recipe
from clear_query.recipes.types import Recipe


def test_recipe_engine_end_to_end():
    # -------------------------
    # input data
    # -------------------------
    df = pd.DataFrame({
        "name": ["Alice", "Bob", "Alice", "David"],
        "age": [25, 30, 25, 40]
    })

    # -------------------------
    # recipe (what user defines)
    # -------------------------
    recipe_data = {
        "operations": [
            {
                "type": "filter_rows",
                "column": "age",
                "operator": ">",
                "value": 25
            },
            {
                "type": "unique",
                "column": "name"
            },
            {
                "type": "rename_column",
                "old_name": "name",
                "new_name": "person_name"
            }
        ]
    }

    # -------------------------
    # parse + run
    # -------------------------
    recipe = Recipe.model_validate(recipe_data)

    result = run_recipe(df, recipe)

    # -------------------------
    # assertions
    # -------------------------
    assert "person_name" in result.columns
    assert "name" not in result.columns

    # age > 25 filter applied
    assert all(result["age"] > 25)

    # uniqueness applied
    assert result["person_name"].is_unique

def test_recipe_order_matters():
    df = pd.DataFrame({
        "name": ["A", "A", "B"],
        "age": [10, 20, 30]
    })

    recipe_data = {
        "operations": [
            {"type": "unique"},
            {"type": "filter_rows", "column": "age", "operator": ">", "value": 15},
        ]
    }

    recipe = Recipe.model_validate(recipe_data)
    result = run_recipe(df, recipe)

    # unique first changes dataset differently than filter-first
    assert len(result) >= 1


def test_filter_rows_all_operators():
    df = pd.DataFrame({"x": [1, 2, 3]})

    cases = [
        ("==", 2, [2]),
        ("!=", 2, [1, 3]),
        (">", 2, [3]),
        ("<", 2, [1]),
        (">=", 2, [2, 3]),
        ("<=", 2, [1, 2]),
    ]

    for operator, value, expected in cases:
        recipe = Recipe.model_validate(
            {"operations": [{"type": "filter_rows", "column": "x", "operator": operator, "value": value}]}
        )
        result = run_recipe(df, recipe)
        assert result["x"].tolist() == expected


def test_rename_column():
    df = pd.DataFrame({"old": [1, 2]})

    recipe = Recipe.model_validate(
        {"operations": [{"type": "rename_column", "old_name": "old", "new_name": "new"}]}
    )
    result = run_recipe(df, recipe)

    assert "new" in result.columns
    assert "old" not in result.columns
    assert result["new"].tolist() == [1, 2]


def test_unique_on_all_columns_when_column_missing():
    df = pd.DataFrame({"a": [1, 1, 2], "b": ["x", "x", "y"]})

    recipe = Recipe.model_validate({"operations": [{"type": "unique"}]})
    result = run_recipe(df, recipe)

    # duplicates across all columns are removed
    assert len(result) == 2


def test_unique_on_specific_column():
    df = pd.DataFrame({"a": [1, 1, 2], "b": ["x", "y", "z"]})

    recipe = Recipe.model_validate({"operations": [{"type": "unique", "column": "a"}]})
    result = run_recipe(df, recipe)

    assert result["a"].is_unique
    assert result["a"].tolist() == [1, 2]


def test_sort_ascending_and_descending():
    df = pd.DataFrame({"x": [3, 1, 2]})

    asc = Recipe.model_validate({"operations": [{"type": "sort", "column": "x", "ascending": True}]})
    desc = Recipe.model_validate({"operations": [{"type": "sort", "column": "x", "ascending": False}]})

    assert run_recipe(df, asc)["x"].tolist() == [1, 2, 3]
    assert run_recipe(df, desc)["x"].tolist() == [3, 2, 1]


def test_set_type_conversion():
    df = pd.DataFrame({
        "to_str": [1, 2, None],
        "to_int": ["10", "20", None],
        "to_float": ["1.1", "2.2", None],
        "to_bool": [0, 1, 0],
        "to_dt": ["2026-05-20", "2026-05-21", None]
    })

    recipe = Recipe.model_validate({
        "operations": [
            {"type": "set_type", "column": "to_str", "dtype": "string"},
            {"type": "set_type", "column": "to_int", "dtype": "int"},
            {"type": "set_type", "column": "to_float", "dtype": "float"},
            {"type": "set_type", "column": "to_bool", "dtype": "boolean"},
            {"type": "set_type", "column": "to_dt", "dtype": "datetime"}
        ]
    })

    res = run_recipe(df, recipe)

    assert isinstance(res["to_str"].dtype, pd.StringDtype)
    assert pd.api.types.is_integer_dtype(res["to_int"])
    assert pd.api.types.is_float_dtype(res["to_float"])
    assert pd.api.types.is_bool_dtype(res["to_bool"])
    assert pd.api.types.is_datetime64_any_dtype(res["to_dt"])


def test_computed_column():
    df = pd.DataFrame({
        "session": ["2026-Fall", "2025-Winter"],
        "a": [10, 20],
        "b": [5, 5]
    })

    recipe = Recipe.model_validate({
        "operations": [
            {"type": "computed_column", "name": "session_year", "expression": "session.str[:4]"},
            {"type": "computed_column", "name": "total", "expression": "a + b"}
        ]
    })

    res = run_recipe(df, recipe)

    assert res["session_year"].tolist() == ["2026", "2025"]
    assert res["total"].tolist() == [15, 25]


def test_replace_value_exact_match_and_casting_success():
    df = pd.DataFrame({"x": [1, 2, 2, 3]})

    recipe = Recipe.model_validate(
        {"operations": [{"type": "replace_value", "column": "x", "value": "2", "replacement": "5"}]}
    )
    res = run_recipe(df, recipe)

    assert res["x"].tolist() == [1, 5, 5, 3]


def test_replace_value_casting_mismatch_errors():
    df = pd.DataFrame({"x": [1, 2, 3]})

    recipe = Recipe.model_validate(
        {"operations": [{"type": "replace_value", "column": "x", "value": "not-an-int", "replacement": "5"}]}
    )
    with pytest.raises(ValueError, match="Cannot cast value to int"):
        run_recipe(df, recipe)
