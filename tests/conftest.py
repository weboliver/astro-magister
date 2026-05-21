import os
os.environ.setdefault('DEBUG', 'true')

import pytest
from app.routers import age_points as age_points_router
from app.routers import horoscope as horoscope_router
from app.routers import positions as positions_router
from app.routers import houses as houses_router
from app.routers import transits as transits_router
from app.routers import solar as solar_router
from app.routers import interpretations as interpretations_router
from app.routers import synastry as synastry_router


class _DummyPerplexityClient:
    def __init__(self, *args, role_type="Laie", **kwargs):
        self.role_type = role_type
        self.model = "dummy-model"

    def get_cached_summary(self, summary, system_prompt=None):
        return None

    def send_summary_text(self, summary, system_prompt=None):
        return "Mocked summary"

    async def send_summary_stream(self, summary, system_prompt=None):
        yield "Mocked summary"

    def _resolve_system_prompt(self, system_prompt):
        return system_prompt


class _DummyRateLimitResult:
    def __init__(self):
        self.allowed = True
        self.limit = 999
        self.retry_after_seconds = 0
        self.is_poweruser = True
        self.is_admin = False


@pytest.fixture(autouse=True)
def mock_perplexity(monkeypatch):
    for router_mod in [
        age_points_router,
        horoscope_router,
        positions_router,
        houses_router,
        transits_router,
        solar_router,
        interpretations_router,
        synastry_router,
    ]:
        monkeypatch.setattr(router_mod, 'PerplexityClient', _DummyPerplexityClient)
        monkeypatch.setattr(router_mod, 'check_ai_rate_limit', lambda *args, **kwargs: _DummyRateLimitResult())