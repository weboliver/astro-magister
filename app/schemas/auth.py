

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class UserOut(BaseModel):
    id: int
    username: str
    role_id: Optional[int] = None
    isadmin: bool = False
    is_poweruser: bool = False
    created: Optional[datetime] = None


class AuthAuditLogOut(BaseModel):
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
    deleted_count: int
    older_than_months: int
    cutoff: datetime


class UserCleanupOut(BaseModel):
    deleted_count: int
    older_than_months: int
    cutoff: datetime


class UserUpdateIn(BaseModel):
    username: Optional[str] = None
    role_id: Optional[int] = None
    isadmin: Optional[bool] = None
    is_poweruser: Optional[bool] = None


class PasswordIn(BaseModel):
    new_password: str

    
class RefreshIn(BaseModel):
    refresh_token: Optional[str] = None


class RoleOut(BaseModel):
    role_id: int
    role_name: Optional[str] = None

  
class LogoutIn(BaseModel):
    refresh_token: Optional[str] = None

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None


class LoginIn(BaseModel):
    username: str
    password: str
    captcha_token: Optional[str] = None


class RegisterIn(BaseModel):
    username: str
    password: str
    captcha_token: Optional[str] = None


class ChangePasswordIn(BaseModel):
    old_password: str
    new_password: str
