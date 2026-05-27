import pandas as pd
import numpy as np
import pytest

from clear_query.mariadb.type_mapping import (
    pandas_dtype_to_mariadb,
    dataframe_to_mariadb_schema,
    quote_identifier,
    render_create_table_sql,
)


class TestPandasDtypeToMariaDB:
    """Test pandas dtype to MariaDB type mapping."""

    def test_int64_to_bigint(self):
        df = pd.DataFrame({"col": pd.array([1, 2, 3], dtype="Int64")})
        assert pandas_dtype_to_mariadb(df["col"].dtype) == "BIGINT"

    def test_float64_to_double(self):
        df = pd.DataFrame({"col": [1.0, 2.5, 3.7]})
        assert pandas_dtype_to_mariadb(df["col"].dtype) == "DOUBLE"

    def test_datetime64_to_datetime(self):
        df = pd.DataFrame({"col": pd.to_datetime(["2021-01-01", "2021-01-02"])})
        assert pandas_dtype_to_mariadb(df["col"].dtype) == "DATETIME"

    def test_bool_to_tinyint(self):
        df = pd.DataFrame({"col": [True, False, True]})
        assert pandas_dtype_to_mariadb(df["col"].dtype) == "TINYINT(1)"

    def test_string_to_text(self):
        df = pd.DataFrame({"col": pd.array(["a", "b", "c"], dtype="string")})
        assert pandas_dtype_to_mariadb(df["col"].dtype) == "TEXT"

    def test_object_dtype_raises(self):
        # Create object dtype by using mixed types or explicit object type
        df = pd.DataFrame({"col": pd.Series([1, "b", 3.0], dtype="object")})
        with pytest.raises(ValueError, match="Unsupported dtype 'object'"):
            pandas_dtype_to_mariadb(df["col"].dtype)

    def test_categorical_dtype_raises(self):
        df = pd.DataFrame({"col": pd.Categorical(["a", "b", "c"])})
        with pytest.raises(ValueError, match="Unsupported dtype"):
            pandas_dtype_to_mariadb(df["col"].dtype)


class TestDataFrameToMariaDBSchema:
    """Test DataFrame schema generation."""

    def test_mixed_dtypes(self):
        df = pd.DataFrame({
            "id": pd.array([1, 2, 3], dtype="Int64"),
            "amount": [10.5, 20.3, 15.7],
            "created_at": pd.to_datetime(["2021-01-01", "2021-01-02", "2021-01-03"]),
            "active": [True, False, True],
            "name": pd.array(["Alice", "Bob", "Charlie"], dtype="string"),
        })

        schema = dataframe_to_mariadb_schema(df)

        assert schema == [
            ("id", "BIGINT"),
            ("amount", "DOUBLE"),
            ("created_at", "DATETIME"),
            ("active", "TINYINT(1)"),
            ("name", "TEXT"),
        ]

    def test_column_order_preserved(self):
        df = pd.DataFrame({
            "z_col": pd.array([1], dtype="Int64"),
            "a_col": [1.0],
            "m_col": pd.to_datetime(["2021-01-01"]),
        })

        schema = dataframe_to_mariadb_schema(df)
        col_names = [col_name for col_name, _ in schema]

        assert col_names == ["z_col", "a_col", "m_col"]

    def test_unsupported_dtype_raises(self):
        df = pd.DataFrame({
            "col1": [1, 2, 3],  # int, supported
            "col2": pd.Series([1, "b", 3.0], dtype="object"),  # mixed object, unsupported
        })

        with pytest.raises(ValueError, match="Unsupported dtype 'object'"):
            dataframe_to_mariadb_schema(df)


class TestQuoteIdentifier:
    """Test SQL identifier quoting."""

    def test_simple_identifier(self):
        assert quote_identifier("id") == "`id`"

    def test_identifier_with_space(self):
        assert quote_identifier("my col") == "`my col`"

    def test_identifier_with_backtick(self):
        assert quote_identifier("weird`name") == "`weird``name`"

    def test_identifier_with_multiple_backticks(self):
        assert quote_identifier("a`b`c") == "`a``b``c`"

    def test_reserved_word(self):
        assert quote_identifier("select") == "`select`"

    def test_empty_identifier(self):
        assert quote_identifier("") == "``"


class TestRenderCreateTableSQL:
    """Test CREATE TABLE SQL generation."""

    def test_simple_create_table(self):
        schema = [("id", "BIGINT"), ("name", "TEXT")]
        sql = render_create_table_sql("users", schema, temporary=True)

        assert "CREATE TEMPORARY TABLE" in sql
        assert "`users`" in sql
        assert "`id` BIGINT" in sql
        assert "`name` TEXT" in sql
        assert sql.endswith(");")

    def test_non_temporary_table(self):
        schema = [("id", "BIGINT")]
        sql = render_create_table_sql("users", schema, temporary=False)

        assert "CREATE TABLE" in sql
        assert "TEMPORARY" not in sql

    def test_identifiers_with_special_chars(self):
        schema = [("my col", "BIGINT"), ("weird`name", "TEXT")]
        sql = render_create_table_sql("my table", schema)

        assert "`my table`" in sql
        assert "`my col`" in sql
        assert "`weird``name`" in sql

    def test_multiple_columns(self):
        schema = [
            ("id", "BIGINT"),
            ("amount", "DOUBLE"),
            ("created_at", "DATETIME"),
            ("active", "TINYINT(1)"),
        ]
        sql = render_create_table_sql("transactions", schema)

        assert "`id` BIGINT" in sql
        assert "`amount` DOUBLE" in sql
        assert "`created_at` DATETIME" in sql
        assert "`active` TINYINT(1)" in sql

    def test_sql_is_valid_structure(self):
        schema = [("col1", "TEXT"), ("col2", "BIGINT")]
        sql = render_create_table_sql("test_table", schema)

        assert sql.startswith("CREATE TEMPORARY TABLE")
        assert sql.endswith(");")
        assert "\n" in sql  # Properly formatted with newlines


class TestEndToEnd:
    """End-to-end integration tests."""

    def test_dataframe_to_create_table_sql(self):
        df = pd.DataFrame({
            "user_id": pd.array([1, 2, 3], dtype="Int64"),
            "email": pd.array(["a@b.com", "c@d.com", "e@f.com"], dtype="string"),
            "balance": [100.50, 200.75, 150.25],
            "joined_at": pd.to_datetime(["2021-01-01", "2021-01-02", "2021-01-03"]),
        })

        schema = dataframe_to_mariadb_schema(df)
        sql = render_create_table_sql("users", schema)

        assert "CREATE TEMPORARY TABLE `users`" in sql
        assert "`user_id` BIGINT" in sql
        assert "`email` TEXT" in sql
        assert "`balance` DOUBLE" in sql
        assert "`joined_at` DATETIME" in sql
