import os

from alembic import context
from sqlalchemy import create_engine

url = os.environ.get("VAYU_DATABASE_URL")
if not url:
    raise SystemExit("VAYU_DATABASE_URL is required to run migrations, e.g. postgresql+psycopg://vayu:...@localhost:5432/vayu")

if context.is_offline_mode():
    context.configure(url=url, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(url)
    with engine.connect() as conn:
        context.configure(connection=conn)
        with context.begin_transaction():
            context.run_migrations()
