from typing import Any
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, text

from clear_query.datasets.parquet_store import read_parquet, ParquetReadInput
from clear_query.mariadb.type_mapping import dataframe_to_mariadb_schema, render_create_table_sql


class MariaDBConnection:
    """Helper class to manage MariaDB connections for temp tables."""

    def __init__(
        self,
        host: str,
        port: int,
        user: str,
        password: str,
        database: str,
        charset: str = "utf8mb4",
        connect_timeout: int = 10,
        keep_alive: bool = False,
    ):
        self.host = host
        self.port = port
        self.user = user
        self.password = password
        self.database = database
        self.charset = charset
        self.connect_timeout = connect_timeout
        self.keep_alive = keep_alive
        self.engine = None
        self.conn = None

    def __enter__(self):
        connection_url = (
            f"mysql+pymysql://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"
            f"?charset={self.charset}&connect_timeout={self.connect_timeout}"
        )
        self.engine = create_engine(connection_url, pool_pre_ping=True)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.engine and not self.keep_alive:
            self.engine.dispose()

    def execute(self, sql: str):
        """Execute a SQL statement."""
        if not self.engine:
            raise RuntimeError("Connection not initialized. Use 'with' statement.")
        with self.engine.connect() as conn:
            conn.execute(text(sql))
            conn.commit()

    def get_create_table_ddl(self, source_name: str, parquet_path: Path) -> str:
        """
        Generate CREATE TABLE DDL for a source's parquet file.

        Returns the DDL string without executing it.

        Args:
            source_name: Name of the source (used as table name)
            parquet_path: Path to the parquet file

        Returns:
            CREATE TABLE DDL statement as string, or empty string if parquet doesn't exist

        Raises:
            ValueError: If schema generation fails
        """
        if not parquet_path.exists():
            return ""

        try:
            config = ParquetReadInput(file_path=parquet_path)
            df = read_parquet(config)
            schema = dataframe_to_mariadb_schema(df)
            create_sql = render_create_table_sql(source_name, schema)
            return create_sql
        except Exception as exc:
            raise ValueError(f"Failed to generate DDL for source '{source_name}': {exc}") from exc

    def sync_source_to_temp_table(self, source_name: str, parquet_path: Path) -> bool:
        """
        Sync a parquet file to a MariaDB table.

        Creates a regular (non-temporary) table that persists across connections.
        Drops any existing table with the same name first.

        Args:
            source_name: Name of the source (used as table name)
            parquet_path: Path to the parquet file

        Returns:
            True if synced, False if parquet doesn't exist

        Raises:
            ValueError: If MariaDB operations fail
        """
        if not parquet_path.exists():
            return False

        if not self.engine:
            raise RuntimeError("Connection not initialized. Use 'with' statement.")

        with self.engine.connect() as conn:
            try:
                # Read parquet
                config = ParquetReadInput(file_path=parquet_path)
                df = read_parquet(config)

                # Get MariaDB schema
                schema = dataframe_to_mariadb_schema(df)
                table_name = source_name

                # Drop existing table (if exists)
                drop_sql = f"DROP TABLE IF EXISTS `{table_name}`"
                conn.execute(text(drop_sql))

                # Create table (regular table, not temporary - so it persists across connections)
                create_sql = render_create_table_sql(table_name, schema, temporary=False)
                conn.execute(text(create_sql))

                # Insert data
                column_list = ",".join([f"`{col_name}`" for col_name, _ in schema])
                placeholders = ",".join([f":{i}" for i in range(len(schema))])
                insert_sql = f"INSERT INTO `{table_name}` ({column_list}) VALUES ({placeholders})"

                # Prepare data for insertion
                for _, row in df.iterrows():
                    row_dict = {str(i): row[col_name] for i, (col_name, _) in enumerate(schema)}
                    # Convert NaN/None to None for proper SQL NULL handling
                    row_dict = {
                        k: (None if pd.isna(v) else v) for k, v in row_dict.items()
                    }
                    conn.execute(text(insert_sql), row_dict)

                conn.commit()
                return True

            except Exception as exc:
                conn.rollback()
                raise ValueError(
                    f"Failed to sync source '{source_name}' to temp table: {exc}"
                ) from exc
