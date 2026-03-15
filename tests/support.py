import uuid
from typing import Callable

from fastapi.testclient import TestClient
import app.config as app_config
from app.db.models.users import User
from app.db.session import get_session
from app.main import app
from app.services import auth as auth_service

# Ensure FastAPI starts in test mode before any clients are created
app_config.TEST = True


PASSWORD = "Secret123!"


class LazyTestClient:
    """Delay TestClient creation until the first request during test execution."""

    def __init__(self, factory: Callable[[], TestClient]) -> None:
        self._factory = factory
        self._client: TestClient | None = None

    def _get_client(self) -> TestClient:
        if self._client is None:
            self._client = self._factory()
        return self._client

    def __getattr__(self, name: str):
        return getattr(self._get_client(), name)


def ensure_test_user(client: TestClient, username: str = "test_user") -> None:
    session = get_session()
    try:
        existing_user = session.query(User).filter(User.username == username).first()
    finally:
        session.close()

    if existing_user is None:
        register = client.post("/auth/register", json={"username": username, "password": PASSWORD})
        assert register.status_code == 201, register.text
        return

    authenticated = auth_service.authenticate_user(username, PASSWORD)
    if authenticated is None:
        assert auth_service.admin_set_password(existing_user.id, PASSWORD)


def build_authenticated_client(client: TestClient | None = None) -> TestClient:
    """Return a TestClient that already carries an Authorization header."""
    client = client or TestClient(app)
    username = "test_user"
    ensure_test_user(client, username)
    login = client.post("/auth/login", json={"username": username, "password": PASSWORD})
    assert login.status_code == 200, login.text
    token = login.json().get("access_token")
    assert token, "Login response must include access_token"
    client.headers.update({"Authorization": f"Bearer {token}"})
    return client


def build_lazy_authenticated_client(client: TestClient | None = None) -> LazyTestClient:
    """Return a lazy proxy so test collection does not hit the database."""
    return LazyTestClient(lambda: build_authenticated_client(client))


def grant_poweruser(username: str = "test_user") -> None:
    user = auth_service.authenticate_user(username, PASSWORD)
    assert user is not None, f"User {username} must exist"
    assert auth_service.admin_update_user(user['id'], {'is_poweruser': True})
