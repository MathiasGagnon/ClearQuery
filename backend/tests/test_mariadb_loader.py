import pandas as pd
import pytest
from unittest.mock import patch, MagicMock

from clear_query.datasets.loaders.mariadb_loader import MariaDBLoaderInput, mariadb_loader


@patch("clear_query.datasets.loaders.mariadb_loader.create_engine")
@patch("pandas.read_sql_query")
def test_mariadb_loader(mock_read_sql, mock_create_engine):
    mock_conn = MagicMock()
    mock_engine = MagicMock()

    mock_create_engine.return_value = mock_engine
    mock_engine.connect.return_value.__enter__.return_value = mock_conn

    expected_df = pd.DataFrame({"a": [1, 2]})
    mock_read_sql.return_value = expected_df

    config = MariaDBLoaderInput(
        host="localhost",
        port=3306,
        user="user",
        password="pass",
        database="db",
        query="SELECT 1"
    )

    df = mariadb_loader(config)

    assert isinstance(df, pd.DataFrame)
    assert df.equals(expected_df)

    mock_create_engine.assert_called_once()
    mock_read_sql.assert_called_once()
    mock_engine.dispose.assert_called_once()