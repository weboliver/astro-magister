from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import datetime
from contextlib import asynccontextmanager
from time import perf_counter
import asyncio
import logging

try:
    from dotenv import load_dotenv
except Exception:
    load_dotenv = None

repo_root = Path(__file__).resolve().parent.parent
env_path = repo_root / ".env"
env_example = repo_root / ".env.example"
if not env_path.exists():
    raise RuntimeError(f"Missing .env file at {env_path}. Copy {env_example} and populate it before starting.")
if load_dotenv:
    load_dotenv(env_path)

from app import config as app_config
from app.services.auth_security import _is_placeholder_secret
from app.routers.date_time import router as date_time_router
from app.routers.positions import router as positions_router
from app.routers.houses import router as houses_router
from app.routers.fixed_stars import router as fixed_stars_router
from app.routers.solar import router as solar_router
from app.routers.age_points import router as age_points_router, public_router as age_points_public_router
from app.routers.horoscope import router as horoscope_router
from app.routers.transits import router as transits_router
from app.routers.auth import router as auth_router
from app.routers.locations import router as locations_router
from app.routers.timezone import router as timezone_router
from app.routers.persons import router as persons_router
from app.routers.cache import router as cache_router
from app.routers.wiki import router as wiki_router, public_router as wiki_public_router
from app.routers.interpretations import router as interpretations_router
from app.services.performance import PerformanceMonitor
from app.services.db_init import init_users_db


def _configure_logging() -> logging.Logger:
    level_name = (app_config.get_env_setting("LOG_LEVEL") or "INFO").upper()
    level = getattr(logging, level_name, None)
    if not isinstance(level, int):
        level = logging.INFO

    root_logger = logging.getLogger()
    if not root_logger.handlers:
        logging.basicConfig(level=level)
    root_logger.setLevel(level)

    for logger_name in ("app", "uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(logger_name).setLevel(level)

    return logging.getLogger("uvicorn.error")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # set application paths used across legacy and API components
    repo_root = Path(__file__).resolve().parent.parent
    app.appath = str(repo_root)
    # Use a per-user home directory for writable DBs (default ~/.astronex)
    home_dir = Path.home().joinpath('.astronex')
    home_dir.mkdir(parents=True, exist_ok=True)
    app.home_dir = str(home_dir)
    # initialize Swiss Ephemeris path and SQLAlchemy schema at startup
    app_config.init_swisseph_path()
    try:
        init_users_db()
    except Exception as e:
        LOGGER.warning(f"Database initialization failed: {e}")
    # ensure country translations use German labels in the UI
    try:
        import astronex.countries as ac
        ac.install('de')
    except Exception as e:
        LOGGER.debug(f"Country translations not available: {e}")
    print(f"INIT Done in: {home_dir}")
    try:
        yield
    finally:
        pass

# Create FastAPI app with lifespan handler
app = FastAPI(
    title="Astronex API",
    description="Ephemeris and astrological calculations using Swiss Ephemeris 2025",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
cors_origins_env = app_config.get_env_setting("CORS_ORIGINS")
cors_origins_list = [o.strip() for o in cors_origins_env.split(",")] if cors_origins_env else []
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins_list,
    allow_credentials=bool(cors_origins_list),
    allow_methods=["*"],
    allow_headers=["*"],
)
performance_monitor = PerformanceMonitor()
app.state.performance_monitor = performance_monitor
LOGGER = _configure_logging()
# Ensure app paths exist before initializing DB at import time (supports TestClient)
repo_root = Path(__file__).resolve().parent.parent
app.appath = str(repo_root)
# Default writable home dir for charts/custom locations
home_dir = Path.home().joinpath('.astronex')
home_dir.mkdir(parents=True, exist_ok=True)
app.home_dir = str(home_dir)
app.config_file = 'cfg.ini'
app.version = '1.2'

turnstile_secret = app_config.get_env_setting("TURNSTILE_SECRET_KEY")
if _is_placeholder_secret(turnstile_secret):
    if not app_config.DEBUG:
        raise ValueError(
            "Turnstile configuration error: TURNSTILE_SECRET_KEY is a placeholder. "
            "Set a valid key or set DEBUG=true for development."
        )
    LOGGER.warning("Turnstile: using placeholder secret - captcha disabled in dev mode")

@app.middleware("http")
async def track_performance(request: Request, call_next):
    start = perf_counter()
    response = await call_next(request)
    elapsed = perf_counter() - start
    performance_monitor.record(request.url.path, elapsed)
    response.headers["X-Astronex-Process-Time"] = f"{elapsed:.6f}s"
    loop = asyncio.get_running_loop()
    loop.call_soon(LOGGER.info, "performance %s %.3fms", request.url.path, elapsed * 1000)
    return response
# Include routers
app.include_router(date_time_router)
app.include_router(positions_router)
app.include_router(houses_router)
app.include_router(fixed_stars_router)
app.include_router(solar_router)
app.include_router(age_points_router)
app.include_router(age_points_public_router)
app.include_router(horoscope_router)
app.include_router(transits_router)
app.include_router(auth_router)
app.include_router(locations_router)
app.include_router(timezone_router)
app.include_router(persons_router)
app.include_router(cache_router)
app.include_router(wiki_router)
app.include_router(wiki_public_router)
app.include_router(interpretations_router)

@app.get("/", tags=["root"])
def read_root():
    return {
        "name": "Astro-Magister API",
        "version": "1.0.0",
        "description": "Ephemeris and astrological calculations"}

@app.get("/health", tags=["system"])
def health_check():
    return {"status": "ok", "timestamp": datetime.datetime.now().isoformat()}
