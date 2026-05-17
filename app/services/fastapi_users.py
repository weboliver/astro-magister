from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Depends
from fastapi_users import BaseUserManager, FastAPIUsers, IntegerIDMixin, exceptions
from fastapi_users.authentication import AuthenticationBackend, BearerTransport, JWTStrategy
from fastapi_users.db import BaseUserDatabase
from fastapi_users.password import PasswordHelperProtocol
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

import app.config as app_config
from app.db.models.users import User, UserProfile
from app.db.session import get_session
from app.services.password_utils import pwd_context, verify_password, hash_password


ALGORITHM = getattr(app_config, 'ALGORITHM', 'HS256')
TOKEN_AUDIENCE = ['astronex:auth']


class PasslibPasswordHelper(PasswordHelperProtocol):
    """Password helper using passlib for hashing and verification."""

    def verify_and_update(self, plain_password: str, hashed_password: str) -> tuple[bool, str | None]:
        """Verify password and update hash if needed.

        Args:
            plain_password: Plain text password to verify.
            hashed_password: Stored hashed password.

        Returns:
            Tuple of (is_valid, updated_hash or None).
        """
        return pwd_context.verify_and_update(plain_password, hashed_password)

    def hash(self, password: str) -> str:
        """Hash a plain text password.

        Args:
            password: Plain text password.

        Returns:
            Hashed password string.
        """
        return pwd_context.hash(password)

    def generate(self) -> str:
        """Generate a temporary random password.

        Returns:
            Hashed temporary password string.
        """
        return pwd_context.hash('temporary-password')


class AstronexUserDatabase(BaseUserDatabase[User, int]):
    """SQLAlchemy-based user database for FastAPI-Users."""

    async def get(self, id: int) -> User | None:
        """Get user by ID.

        Args:
            id: User ID.

        Returns:
            User object or None if not found.
        """
        session = get_session()
        try:
            return session.query(User).options(joinedload(User.profile)).filter(User.id == id).first()
        finally:
            session.close()

    async def get_by_email(self, email: str) -> User | None:
        """Get user by email/username.

        Args:
            email: Email or username string.

        Returns:
            User object or None if not found.
        """
        session = get_session()
        try:
            return session.query(User).options(joinedload(User.profile)).filter(User.username == email).first()
        finally:
            session.close()

    async def get_by_oauth_account(self, oauth: str, account_id: str) -> User | None:
        """OAuth not supported."""
        return None

    async def create(self, create_dict: dict[str, object]) -> User:
        """Create a new user.

        Args:
            create_dict: Dictionary with user creation data.

        Returns:
            Created User object.

        Raises:
            UserAlreadyExists: If user already exists.
        """
        session = get_session()
        try:
            username = str(create_dict.get('username') or create_dict.get('email') or '').strip()
            if not username:
                raise ValueError('Username is required')

            user = User(username=username, password_hash=str(create_dict.get('hashed_password') or create_dict.get('password_hash') or ''))
            session.add(user)
            session.flush()

            profile = session.query(UserProfile).filter(UserProfile.user_id == user.id).first()
            if not profile:
                profile = UserProfile(user_id=user.id)
            profile.isadmin = bool(create_dict.get('is_superuser') or create_dict.get('isadmin'))
            profile.is_poweruser = bool(create_dict.get('is_poweruser'))
            session.add(profile)

            session.commit()
            session.refresh(user)
            session.refresh(profile)
            user.profile = profile
            return user
        except IntegrityError as exc:
            session.rollback()
            raise exceptions.UserAlreadyExists() from exc
        finally:
            session.close()

    async def update(self, user: User, update_dict: dict[str, object]) -> User:
        """Update an existing user.

        Args:
            user: User object to update.
            update_dict: Dictionary with update data.

        Returns:
            Updated User object.

        Raises:
            UserAlreadyExists: If username already exists.
        """
        session = get_session()
        try:
            db_user = session.query(User).options(joinedload(User.profile)).filter(User.id == user.id).first()
            if db_user is None:
                raise exceptions.UserNotExists()

            username = update_dict.get('username') or update_dict.get('email')
            if username is not None:
                db_user.username = str(username).strip()

            hashed_password = update_dict.get('hashed_password') or update_dict.get('password_hash')
            if hashed_password is not None:
                db_user.password_hash = str(hashed_password)

            if 'is_superuser' in update_dict or 'isadmin' in update_dict or 'is_poweruser' in update_dict:
                profile = session.query(UserProfile).filter(UserProfile.user_id == db_user.id).first()
                if not profile:
                    profile = UserProfile(user_id=db_user.id)
                if 'is_superuser' in update_dict or 'isadmin' in update_dict:
                    profile.isadmin = bool(update_dict.get('is_superuser') if 'is_superuser' in update_dict else update_dict.get('isadmin'))
                if 'is_poweruser' in update_dict:
                    profile.is_poweruser = bool(update_dict.get('is_poweruser'))
                session.add(profile)

            session.add(db_user)
            session.commit()
            session.refresh(db_user)
            if db_user.profile is not None:
                session.refresh(db_user.profile)
            return db_user
        except IntegrityError as exc:
            session.rollback()
            raise exceptions.UserAlreadyExists() from exc
        finally:
            session.close()

    async def delete(self, user: User) -> None:
        """Delete a user.

        Args:
            user: User object to delete.
        """
        session = get_session()
        try:
            db_user = session.query(User).filter(User.id == user.id).first()
            if db_user is None:
                return
            session.delete(db_user)
            session.commit()
        finally:
            session.close()

    async def add_oauth_account(self, user: User, create_dict: dict[str, object]) -> User:
        """OAuth not supported."""
        raise NotImplementedError()

    async def update_oauth_account(self, user: User, oauth_account: object, update_dict: dict[str, object]) -> User:
        """OAuth not supported."""
        raise NotImplementedError()


class AstronexUserManager(IntegerIDMixin, BaseUserManager[User, int]):
    """Custom user manager for Astronex users."""

    reset_password_token_secret = app_config.SECRET_KEY
    verification_token_secret = app_config.SECRET_KEY

    async def get_by_username(self, username: str) -> User | None:
        """Get user by username.

        Args:
            username: Username string.

        Returns:
            User object or None.
        """
        return await self.user_db.get_by_email(username.strip())

    async def create_with_username(self, username: str, password: str, is_superuser: bool = False) -> User:
        """Create a new user with username and password.

        Args:
            username: Username string.
            password: Plain text password.
            is_superuser: Whether user should be superuser.

        Returns:
            Created User object.

        Raises:
            UserAlreadyExists: If username already exists.
        """
        existing = await self.get_by_username(username)
        if existing is not None:
            raise exceptions.UserAlreadyExists()

        hashed_password = self.password_helper.hash(password)
        return await self.user_db.create({
            'username': username.strip(),
            'hashed_password': hashed_password,
            'is_superuser': is_superuser,
        })

    async def authenticate_with_username(self, username: str, password: str) -> User | None:
        """Authenticate user by username and password.

        Args:
            username: Username string.
            password: Plain text password.

        Returns:
            Authenticated User object or None.
        """
        user = await self.get_by_username(username)
        if user is None:
            return None

        verified, updated_hash = self.password_helper.verify_and_update(password, user.hashed_password)
        if not verified:
            return None
        if updated_hash is not None:
            user = await self.user_db.update(user, {'hashed_password': updated_hash})
        return user


async def get_user_db() -> AsyncIterator[AstronexUserDatabase]:
    """Dependency to get user database instance."""
    yield AstronexUserDatabase()


async def get_user_manager(user_db: AstronexUserDatabase = Depends(get_user_db)) -> AsyncIterator[AstronexUserManager]:
    """Dependency to get user manager instance."""
    yield AstronexUserManager(user_db, password_helper=PasslibPasswordHelper())


def build_user_manager() -> AstronexUserManager:
    """Build a user manager instance.

    Returns:
        AstronexUserManager instance.
    """
    return AstronexUserManager(AstronexUserDatabase(), password_helper=PasslibPasswordHelper())


bearer_transport = BearerTransport(tokenUrl='/auth/login')


def get_jwt_strategy() -> JWTStrategy[User, int]:
    """Create JWT strategy for authentication.

    Returns:
        JWTStrategy instance.
    """
    return JWTStrategy(
        secret=app_config.SECRET_KEY,
        lifetime_seconds=app_config.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        token_audience=TOKEN_AUDIENCE,
        algorithm=ALGORITHM,
    )


auth_backend = AuthenticationBackend(
    name='jwt',
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)


fastapi_users = FastAPIUsers[User, int](get_user_manager, [auth_backend])
current_active_user = fastapi_users.current_user(active=True)


def user_to_dict(user: User) -> dict[str, object]:
    """Convert User object to dictionary.

    Args:
        user: User object.

    Returns:
        Dictionary with user data.
    """
    return {
        'id': user.id,
        'username': user.username,
        'isadmin': bool(user.is_superuser),
        'is_poweruser': bool(user.is_poweruser),
    }


async def authenticate_by_username(username: str, password: str) -> User | None:
    """Authenticate user by username and password.

    Args:
        username: Username string.
        password: Plain text password.

    Returns:
        Authenticated User or None.
    """
    return await build_user_manager().authenticate_with_username(username, password)


async def create_user_with_username(username: str, password: str, is_superuser: bool = False) -> User:
    """Create a new user with username.

    Args:
        username: Username string.
        password: Plain text password.
        is_superuser: Whether user should be superuser.

    Returns:
        Created User object.
    """
    return await build_user_manager().create_with_username(username, password, is_superuser=is_superuser)


async def get_user_by_id_async(user_id: int) -> User | None:
    """Get user by ID asynchronously.

    Args:
        user_id: User ID.

    Returns:
        User object or None.
    """
    return await AstronexUserDatabase().get(user_id)


async def issue_access_token(user: User) -> str:
    """Issue JWT access token for user.

    Args:
        user: User object.

    Returns:
        JWT token string.
    """
    return await get_jwt_strategy().write_token(user)