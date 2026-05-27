import tempfile
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

import pandas as pd
import pytest

from clear_query.mariadb.temp_tables import MariaDBConnection
from clear_query.datasets.parquet_store import write_parquet, ParquetWriteInput


@pytest.fixture
def temp_parquet():
    """Create a temporary parquet file for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)

        # Create test data
        df = pd.DataFrame({
            "id": pd.array([1, 2, 3], dtype="Int64"),
            "name": pd.array(["Alice", "Bob", "Charlie"], dtype="string"),
            "amount": [10.5, 20.3, 15.7],
            "created_at": pd.to_datetime(["2021-01-01", "2021-01-02", "2021-01-03"]),
        })

        parquet_path = tmpdir_path / "test.parquet"
        config = ParquetWriteInput(df=df, output_path=parquet_path)
        write_parquet(config)

        yield parquet_path


def test_mariadb_connection_context_manager():
    """Test MariaDBConnection context manager initialization."""
    conn = MariaDBConnection(
        host="localhost",
        port=3306,
        user="test",
        password="test",
        database="test_db",
    )

    assert conn.host == "localhost"
    assert conn.port == 3306
    assert conn.user == "test"
    assert conn.database == "test_db"


@patch("clear_query.mariadb.temp_tables.create_engine")
def test_sync_source_parquet_not_exists(mock_create_engine):
    """Test that sync returns False when parquet doesn't exist."""
    conn = MariaDBConnection(
        host="localhost",
        port=3306,
        user="test",
        password="test",
        database="test_db",
    )

    # This would normally fail at engine creation, but we're testing the early return
    nonexistent_path = Path("/nonexistent/path/test.parquet")

    with patch.object(conn, "engine", None):
        result = conn.sync_source_to_temp_table("test_source", nonexistent_path)
        assert result is False


def test_sync_source_requires_connection(temp_parquet):
    """Test that sync raises error when connection not initialized."""
    conn = MariaDBConnection(
        host="localhost",
        port=3306,
        user="test",
        password="test",
        database="test_db",
    )

    # Don't use 'with' context manager - engine won't be initialized
    with pytest.raises(RuntimeError, match="Connection not initialized"):
        conn.sync_source_to_temp_table("test_source", temp_parquet)


@patch("clear_query.mariadb.temp_tables.create_engine")
def test_sync_source_to_temp_table_success(mock_create_engine, temp_parquet):
    """Test successful sync of parquet to temp table."""
    # Mock the engine and connection
    mock_conn = MagicMock()
    mock_engine = MagicMock()
    mock_engine.connect.return_value.__enter__.return_value = mock_conn
    mock_engine.connect.return_value.__exit__.return_value = None
    mock_create_engine.return_value = mock_engine

    conn = MariaDBConnection(
        host="localhost",
        port=3306,
        user="test",
        password="test",
        database="test_db",
    )

    with conn:
        result = conn.sync_source_to_temp_table("test_source", temp_parquet)
        assert result is True

        # Verify execute was called at least 5 times (DROP + CREATE + 3 INSERTs)
        assert mock_conn.execute.call_count >= 5

        # Verify commit was called
        assert mock_conn.commit.called


@patch("clear_query.mariadb.temp_tables.create_engine")
def test_sync_source_handles_nan_values(mock_create_engine, temp_parquet):
    """Test that NaN/None values are properly handled."""
    mock_conn = MagicMock()
    mock_engine = MagicMock()
    mock_engine.connect.return_value.__enter__.return_value = mock_conn
    mock_engine.connect.return_value.__exit__.return_value = None
    mock_create_engine.return_value = mock_engine

    # Create parquet with NaN values
    with tempfile.TemporaryDirectory() as tmpdir:
        df = pd.DataFrame({
            "id": pd.array([1, 2, None], dtype="Int64"),
            "value": [1.5, float('nan'), 3.5],
        })

        parquet_path = Path(tmpdir) / "test_nan.parquet"
        config = ParquetWriteInput(df=df, output_path=parquet_path)
        write_parquet(config)

        conn = MariaDBConnection(
            host="localhost",
            port=3306,
            user="test",
            password="test",
            database="test_db",
        )

        with conn:
            result = conn.sync_source_to_temp_table("test_source", parquet_path)
            assert result is True


@patch("clear_query.mariadb.temp_tables.create_engine")
def test_sync_source_error_handling(mock_create_engine):
    """Test error handling during sync."""
    # Mock engine to raise an error during execute
    mock_conn = MagicMock()
    mock_conn.execute.side_effect = Exception("Database error")
    mock_engine = MagicMock()
    mock_engine.connect.return_value.__enter__.return_value = mock_conn
    mock_engine.connect.return_value.__exit__.return_value = None
    mock_create_engine.return_value = mock_engine

    with tempfile.TemporaryDirectory() as tmpdir:
        df = pd.DataFrame({"col": [1, 2, 3]})
        parquet_path = Path(tmpdir) / "test.parquet"
        config = ParquetWriteInput(df=df, output_path=parquet_path)
        write_parquet(config)

        conn = MariaDBConnection(
            host="localhost",
            port=3306,
            user="test",
            password="test",
            database="test_db",
        )

        with conn:
            with pytest.raises(ValueError, match="Failed to sync source"):
                conn.sync_source_to_temp_table("test_source", parquet_path)

        # Verify rollback was called
        assert mock_conn.rollback.called
