from typing import Optional

import pandas as pd
from pydantic import BaseModel, Field
from sqlalchemy import create_engine


class MariaDBLoaderInput(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str
    query: str = Field(..., description="SQL query to execute")
    charset: str = "utf8mb4"
    connect_timeout: int = 10
    use_ssl: bool = False


def mariadb_loader(config: MariaDBLoaderInput) -> pd.DataFrame:
    """
    Execute a SQL query on a MariaDB database and return results as a DataFrame.

    Uses SQLAlchemy with PyMySQL driver.

    Args:
        config: Validated MariaDB connection + query config.

    Returns:
        pandas.DataFrame
    """

    ssl_args = "?ssl_disabled=true" if not config.use_ssl else ""

    connection_url = (
        f"mysql+pymysql://{config.user}:{config.password}"
        f"@{config.host}:{config.port}/{config.database}"
        f"?charset={config.charset}&connect_timeout={config.connect_timeout}"
    )

    engine = create_engine(connection_url, pool_pre_ping=True)

    try:
        with engine.connect() as conn:
            df = pd.read_sql_query(config.query, conn)
        return df
    finally:
        engine.dispose()