

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class UserOut(BaseModel):
    """User output schema."""

    id: int
    username: str
    role_id: Optional[int] = None
    isadmin: bool = False
    is_poweruser: bool = False
    created: Optional[datetime] = None


class AuthAuditLogOut(BaseModel):
    """Authentication audit log entry."""

    id: int
    user_id: Optional[int] = None
    username: Optional[str] = None
    event_type: str
    success: bool
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    detail: Optional[str] = None
    created: datetime


class AuthAuditLogCleanupOut(BaseModel):
    """Result of auth audit log cleanup."""

    deleted_count: int
    older_than_months: int
    cutoff: datetime


class UserCleanupOut(BaseModel):
    """Result of user cleanup operation."""

    deleted_count: int
    older_than_months: int
    cutoff: datetime


class UserUpdateIn(BaseModel):
    """User update input schema."""

    username: Optional[str] = None
    role_id: Optional[int] = None
    isadmin: Optional[bool] = None
    is_poweruser: Optional[bool] = None


class PasswordIn(BaseModel):
    """Password change input."""

    new_password: str


class RefreshIn(BaseModel):
    """Token refresh input."""

    refresh_token: Optional[str] = None


class RoleOut(BaseModel):
    """Role output schema."""

    role_id: int
    role_name: Optional[str] = None


class LogoutIn(BaseModel):
    """Logout input schema."""

    refresh_token: Optional[str] = None


class Token(BaseModel):
    """Authentication token response."""

    access_token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None


class LoginIn(BaseModel):
    """Login input schema."""

    username: str
    password: str
    captcha_token: Optional[str] = None


class RegisterIn(BaseModel):
    """Registration input schema."""

    username: str
    password: str
    captcha_token: Optional[str] = None


class ChangePasswordIn(BaseModel):
    """Password change input with old password."""

    old_password: str
    new_password: str


class ProviderConfigOut(BaseModel):
    """Provider configuration response schema."""

    chat_provider: str
    available_providers: List[str]


class ProviderConfigIn(BaseModel):
    """Provider configuration update request schema."""

    chat_provider: str
