"""
Database configuration for vayu-swachh.
Supports PostgreSQL with PostGIS extension and TimescaleDB for time-series data.
Also configures Redis for event bus and distributed locking.
"""
import os
from sqlalchemy import create_engine, Engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy import event

# Environment variables
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg2://vayu:vayu@localhost:5432/vayu_swachh")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
TIMESCALE_DB_URL = os.getenv("TIMESCALE_DB_URL", DATABASE_URL)

# Synchronous engine
engine: Engine = create_engine(
    DATABASE_URL,
    pool_size=20,
    max_overflow=30,
    pool_timeout=30,
    echo=False,
)

# Asynchronous engine for FastAPI async endpoints
async_engine = create_async_engine(
    DATABASE_URL.replace("postgresql+psycopg2", "postgresql+asyncpg"),
    pool_size=20,
    max_overflow=30,
    pool_timeout=30,
    echo=False,
)

# Session factories
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
AsyncSessionLocal = sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)


def get_db() -> Session:
    """Dependency to get a synchronous DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def get_async_db() -> AsyncSession:
    """Dependency to get an asynchronous DB session."""
    async with AsyncSessionLocal() as session:
        yield session


# PostGIS and TimescaleDB events
@event.listens_for(engine, "connect")
def on_connect(dbapi_connection, connection_record):
    """Set PostGIS and TimescaleDB extensions on connection."""
    cursor = dbapi_connection.cursor()
    # Enable PostGIS extension
    cursor.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
    # Enable TimescaleDB extension
    cursor.execute("CREATE EXTENSION IF NOT EXISTS timescaledb;")
    cursor.close()


# Redis client factory
import redis as redis_lib

redis_client = redis_lib.from_url(REDIS_URL, decode_responses=True)


def get_redis():
    """Get Redis client for event bus and distributed locks."""
    return redis_client