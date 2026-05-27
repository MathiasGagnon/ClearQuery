from typing import Any
import pandas as pd
import numpy as np


def quote_identifier(name: str) -> str:
    """
    Quote a SQL identifier with backticks, escaping any backticks in the name.

    Args:
        name: The identifier to quote (e.g., column name, table name)

    Returns:
        The quoted identifier (e.g., `my_col` or `my`col`)
    """
    escaped = name.replace("`", "``")
    return f"`{escaped}`"


def pandas_dtype_to_mariadb(dtype: Any) -> str:
    """
    Map a pandas dtype to a MariaDB SQL type string.

    Supported dtypes:
    - string/StringDtype → TEXT
    - Int64/int64 → BIGINT
    - float64 → DOUBLE
    - datetime64[ns] → DATETIME
    - bool → TINYINT(1)

    Args:
        dtype: A pandas dtype object

    Returns:
        A MariaDB SQL type string

    Raises:
        ValueError: If the dtype is not supported
    """
    # Object type - check first since is_string_dtype returns True for object
    if dtype == "object":
        raise ValueError(
            f"Unsupported dtype 'object': ambiguous type. "
            "Only string, int, float, boolean, and datetime types are supported."
        )

    # Integer types
    if pd.api.types.is_integer_dtype(dtype):
        return "BIGINT"

    # Float types
    if pd.api.types.is_float_dtype(dtype):
        return "DOUBLE"

    # Datetime types
    if pd.api.types.is_datetime64_any_dtype(dtype):
        return "DATETIME"

    # Boolean type
    if pd.api.types.is_bool_dtype(dtype):
        return "TINYINT(1)"

    # String types (StringDtype)
    if pd.api.types.is_string_dtype(dtype):
        return "TEXT"

    raise ValueError(
        f"Unsupported dtype '{dtype}': only string, int, float, boolean, and datetime types are supported."
    )


def dataframe_to_mariadb_schema(df: pd.DataFrame) -> list[tuple[str, str]]:
    """
    Generate a MariaDB schema from a pandas DataFrame.

    Args:
        df: The DataFrame to convert

    Returns:
        An ordered list of (column_name, sql_type) tuples

    Raises:
        ValueError: If any column has an unsupported dtype
    """
    schema: list[tuple[str, str]] = []

    for col_name in df.columns:
        col_dtype = df[col_name].dtype
        sql_type = pandas_dtype_to_mariadb(col_dtype)
        schema.append((str(col_name), sql_type))

    return schema


def render_create_table_sql(
    table: str,
    schema: list[tuple[str, str]],
    temporary: bool = True,
) -> str:
    """
    Generate a CREATE TABLE SQL statement.

    Args:
        table: The table name
        schema: List of (column_name, sql_type) tuples from dataframe_to_mariadb_schema()
        temporary: If True, create a TEMPORARY table

    Returns:
        A CREATE TABLE SQL statement
    """
    table_keyword = "TEMPORARY TABLE" if temporary else "TABLE"
    quoted_table = quote_identifier(table)

    # Build column definitions
    column_defs = []
    for col_name, sql_type in schema:
        quoted_col = quote_identifier(col_name)
        # Append CHARACTER SET for text columns so they never inherit a latin1
        # database default — accented characters would otherwise be garbled or lost.
        if sql_type == "TEXT":
            column_defs.append(f"{quoted_col} {sql_type} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        else:
            column_defs.append(f"{quoted_col} {sql_type}")

    columns_sql = ",\n  ".join(column_defs)

    # Explicitly set the table charset so MariaDB never falls back to latin1.
    sql = (
        f"CREATE {table_keyword} {quoted_table} (\n  {columns_sql}\n)"
        f" DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    )

    return sql
