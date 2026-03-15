from __future__ import annotations
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# load .env into environment (if present)
load_dotenv()

# Build the Postgres URL from env credentials while keeping the port fixed.
# Local host access uses the published Docker port 5433, while Docker-internal
# service-to-service traffic must still target PostgreSQL on 5432.
DB_HOST = os.environ.get('DB_HOST', 'localhost')
DB_NAME = os.environ.get('DB_NAME', 'astronex')
DB_USER = os.environ.get('DB_USER', 'postgres')
DB_PASS = os.environ.get('DB_PASSWORD', 'postgres')
DB_PORT = 5433 if DB_HOST in {'localhost', '127.0.0.1'} else 5432
DATABASE_URL = f'postgresql+psycopg2://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}'

# create sync engine
engine = create_engine(DATABASE_URL, echo=False, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()

def get_engine():
    return engine

def get_session():
    return SessionLocal()
