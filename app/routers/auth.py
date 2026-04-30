from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt

import app.config as app_config
from app.schemas.auth import *
from app.schemas.profile import *
from app.services import auth as auth_service
from app.services.auth_security import (
    FAILED_LOGIN_LOCKOUT_SECONDS,
    LOGIN_RATE_LIMIT_ATTEMPTS,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    REFRESH_RATE_LIMIT_ATTEMPTS,
    REFRESH_RATE_LIMIT_WINDOW_SECONDS,
    REGISTER_RATE_LIMIT_ATTEMPTS,
    REGISTER_RATE_LIMIT_WINDOW_SECONDS,
    check_rate_limit,
    clear_failed_logins,
    get_client_ip,
    get_login_lock,
    log_auth_event,
    record_failed_login,
    validate_password_strength,
    verify_turnstile_token,
)
from app.services.fastapi_users import (
    TOKEN_AUDIENCE,
    authenticate_by_username,
    create_user_with_username,
    get_user_by_id_async,
    issue_access_token,
)
from fastapi_users import exceptions as fastapi_users_exceptions

router = APIRouter()
bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name='BearerAuth',
    description='JWT access token from /auth/login',
)
ACCESS_COOKIE_NAME = (app_config.get_env_setting('AUTH_ACCESS_COOKIE_NAME') or 'astronex_access_token').strip() or 'astronex_access_token'
REFRESH_COOKIE_NAME = (app_config.get_env_setting('AUTH_REFRESH_COOKIE_NAME') or 'astronex_refresh_token').strip() or 'astronex_refresh_token'
COOKIE_SAMESITE = (app_config.get_env_setting('AUTH_COOKIE_SAMESITE') or 'lax').strip() or 'lax'
COOKIE_DOMAIN = (app_config.get_env_setting('AUTH_COOKIE_DOMAIN') or '').strip() or None
COOKIE_SECURE = (app_config.get_env_setting('AUTH_COOKIE_SECURE') or '1').strip().lower() in {'1', 'true', 'yes', 'on'}
REFRESH_TOKEN_MAX_AGE_SECONDS = int(app_config.get_env_setting('REFRESH_TOKEN_EXPIRE_SECONDS') or 7 * 24 * 3600)


def _cookie_settings(max_age: int) -> dict:
    return {
        'httponly': True,
        'secure': COOKIE_SECURE,
        'samesite': COOKIE_SAMESITE,
        'max_age': max_age,
        'path': '/',
        'domain': COOKIE_DOMAIN,
    }


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(ACCESS_COOKIE_NAME, access_token, **_cookie_settings(app_config.ACCESS_TOKEN_EXPIRE_MINUTES * 60))
    response.set_cookie(REFRESH_COOKIE_NAME, refresh_token, **_cookie_settings(REFRESH_TOKEN_MAX_AGE_SECONDS))


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE_NAME, path='/', domain=COOKIE_DOMAIN)
    response.delete_cookie(REFRESH_COOKIE_NAME, path='/', domain=COOKIE_DOMAIN)


def _rate_limit_exception(detail: str, retry_after_seconds: int) -> HTTPException:
    return HTTPException(status_code=429, detail=detail, headers={'Retry-After': str(retry_after_seconds)})


def _lockout_exception(retry_after_seconds: int) -> HTTPException:
    return HTTPException(
        status_code=423,
        detail='Zu viele Fehlversuche. Der Zugang ist für 1 Stunde gesperrt. Bitte später erneut versuchen.',
        headers={'Retry-After': str(retry_after_seconds)},
    )


def _resolve_refresh_token(payload: RefreshIn | LogoutIn | None, request: Request) -> Optional[str]:
    if payload and payload.refresh_token:
        return payload.refresh_token
    return request.cookies.get(REFRESH_COOKIE_NAME)


def _unauthorized_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail='Unauthorized',
        headers={'WWW-Authenticate': 'Bearer'},
    )

@router.post('/auth/register', status_code=201)
async def register(payload: RegisterIn, request: Request):
    client_ip = get_client_ip(request)
    user_agent = request.headers.get('user-agent')
    rate_limit = check_rate_limit('register', client_ip, REGISTER_RATE_LIMIT_ATTEMPTS, REGISTER_RATE_LIMIT_WINDOW_SECONDS)
    if not rate_limit.allowed:
        log_auth_event(event_type='register_rate_limited', success=False, username=payload.username, ip_address=client_ip, user_agent=user_agent, detail='Rate limit exceeded')
        raise _rate_limit_exception('Zu viele Registrierungsversuche. Bitte später erneut versuchen.', rate_limit.retry_after_seconds)

    password_error = validate_password_strength(payload.password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)

    captcha_valid = await verify_turnstile_token(payload.captcha_token, client_ip)
    if not captcha_valid:
        log_auth_event(event_type='register_captcha_failed', success=False, username=payload.username, ip_address=client_ip, user_agent=user_agent, detail='Captcha verification failed')
        raise HTTPException(status_code=400, detail='Captcha-Prüfung fehlgeschlagen')

    try:
        await create_user_with_username(payload.username, payload.password)
    except fastapi_users_exceptions.UserAlreadyExists:
        log_auth_event(event_type='register_failed', success=False, username=payload.username, ip_address=client_ip, user_agent=user_agent, detail='User already exists')
        raise HTTPException(status_code=400, detail='User already exists')
    log_auth_event(event_type='register_success', success=True, username=payload.username, ip_address=client_ip, user_agent=user_agent)
    return {"username": payload.username}


@router.post('/auth/login', response_model=Token)
async def login(payload: LoginIn, request: Request, response: Response):
    client_ip = get_client_ip(request)
    user_agent = request.headers.get('user-agent')
    lock_seconds = get_login_lock(payload.username)
    if lock_seconds > 0:
        log_auth_event(event_type='login_locked', success=False, username=payload.username, ip_address=client_ip, user_agent=user_agent, detail='Account temporarily locked')
        raise _lockout_exception(lock_seconds)

    rate_limit = check_rate_limit('login', client_ip, LOGIN_RATE_LIMIT_ATTEMPTS, LOGIN_RATE_LIMIT_WINDOW_SECONDS)
    if not rate_limit.allowed:
        log_auth_event(event_type='login_rate_limited', success=False, username=payload.username, ip_address=client_ip, user_agent=user_agent, detail='Rate limit exceeded')
        raise _rate_limit_exception('Zu viele Login-Versuche. Bitte später erneut versuchen.', rate_limit.retry_after_seconds)

    captcha_valid = await verify_turnstile_token(payload.captcha_token, client_ip)
    if not captcha_valid:
        log_auth_event(event_type='login_captcha_failed', success=False, username=payload.username, ip_address=client_ip, user_agent=user_agent, detail='Captcha verification failed')
        raise HTTPException(status_code=400, detail='Captcha-Prüfung fehlgeschlagen')

    user = await authenticate_by_username(payload.username, payload.password)
    if not user:
        lock_seconds = record_failed_login(payload.username)
        log_auth_event(event_type='login_failed', success=False, username=payload.username, ip_address=client_ip, user_agent=user_agent, detail='Incorrect username or password')
        if lock_seconds > 0:
            raise _lockout_exception(lock_seconds)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Incorrect username or password",
                            headers={"WWW-Authenticate": "Bearer"})
    clear_failed_logins(payload.username)
    access_token = await issue_access_token(user)
    refresh_token = auth_service.create_refresh_token(user.id)
    _set_auth_cookies(response, access_token, refresh_token)
    log_auth_event(event_type='login_success', success=True, username=user.username, user_id=user.id, ip_address=client_ip, user_agent=user_agent)
    return {"access_token": access_token, "token_type": "bearer", "refresh_token": refresh_token}


@router.post('/auth/refresh', response_model=Token)
async def refresh_token(request: Request, response: Response, payload: RefreshIn | None = None):
    client_ip = get_client_ip(request)
    user_agent = request.headers.get('user-agent')
    rate_limit = check_rate_limit('refresh', client_ip, REFRESH_RATE_LIMIT_ATTEMPTS, REFRESH_RATE_LIMIT_WINDOW_SECONDS)
    if not rate_limit.allowed:
        log_auth_event(event_type='refresh_rate_limited', success=False, ip_address=client_ip, user_agent=user_agent, detail='Rate limit exceeded')
        raise _rate_limit_exception('Zu viele Token-Aktualisierungen. Bitte später erneut versuchen.', rate_limit.retry_after_seconds)

    refresh_token_value = _resolve_refresh_token(payload, request)
    rid = auth_service.verify_refresh_token(refresh_token_value) if refresh_token_value else None
    if not rid:
        raise HTTPException(status_code=401, detail='Invalid or expired refresh token')
    # create new access token and rotate refresh token
    user = await get_user_by_id_async(rid)
    if not user:
        raise HTTPException(status_code=401, detail='User not found')
    access_token = await issue_access_token(user)
    # revoke old and issue new refresh token
    auth_service.revoke_refresh_token(refresh_token_value)
    new_refresh = auth_service.create_refresh_token(user.id)
    _set_auth_cookies(response, access_token, new_refresh)
    return {"access_token": access_token, "token_type": "bearer", "refresh_token": new_refresh}


@router.post('/auth/logout-refresh')
def logout_refresh(request: Request, response: Response, payload: LogoutIn | None = None):
    refresh_token_value = _resolve_refresh_token(payload, request)
    if refresh_token_value:
        auth_service.revoke_refresh_token(refresh_token_value)
    _clear_auth_cookies(response)
    return {'status':'ok'}


def _get_user_from_request(request: Request):
    auth = request.headers.get('authorization') or request.headers.get('Authorization')
    if auth:
        parts = auth.split()
        if len(parts) == 2 and parts[0].lower() == 'bearer':
            return _get_user_from_token(parts[1])
    cookie_token = request.cookies.get(ACCESS_COOKIE_NAME)
    if cookie_token:
        return _get_user_from_token(cookie_token)
    return None


def _get_user_from_token(token: str):
    try:
        data = jwt.decode(
            token,
            app_config.SECRET_KEY,
            algorithms=[app_config.ALGORITHM if hasattr(app_config,'ALGORITHM') else 'HS256'],
            audience=TOKEN_AUDIENCE[0],
        )
    except Exception:
        return None
    uid = data.get('sub')
    if uid:
        return auth_service.get_user_by_id(int(uid))
    return None


def require_authenticated_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
):
    user = None
    if credentials and credentials.credentials:
        if credentials.scheme.lower() != 'bearer':
            raise _unauthorized_exception()
        user = _get_user_from_token(credentials.credentials)
    if not user:
        cookie_token = request.cookies.get(ACCESS_COOKIE_NAME)
        if cookie_token:
            user = _get_user_from_token(cookie_token)
    if not user:
        raise _unauthorized_exception()
    return user


def require_admin_user(user=Depends(require_authenticated_user)):
    prof = auth_service.get_profile(user['id']) or {}
    if not prof.get('isadmin'):
        raise HTTPException(status_code=403, detail='Forbidden')
    return user

@router.post('/auth/logout')
def logout(response: Response, user=Depends(require_authenticated_user)):
    auth_service.revoke_user_refresh_tokens(user['id'])
    _clear_auth_cookies(response)
    return {'status':'ok'}


@router.get('/auth/roles', response_model=list[RoleOut])
def get_roles(user=Depends(require_authenticated_user)):
    return auth_service.list_roles()


@router.post('/auth/change-password')
def change_password(payload: ChangePasswordIn, user=Depends(require_authenticated_user)):
    password_error = validate_password_strength(payload.new_password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)
    ok = auth_service.change_password(user['id'], payload.old_password, payload.new_password)
    if not ok:
        raise HTTPException(status_code=400, detail='Old password incorrect or error')
    return {'status': 'ok'}


@router.get('/auth/profile', response_model=ProfileOut)
def get_profile(user=Depends(require_authenticated_user)):
    prof = auth_service.get_profile(user['id'])
    return prof or {}


@router.put('/auth/profile')
def update_profile(payload: ProfileIn, user=Depends(require_authenticated_user)):
    ok = auth_service.update_profile(user['id'], payload.model_dump())
    if not ok:
        raise HTTPException(status_code=500, detail='Could not update profile')
    return {'status': 'ok'}


@router.get('/auth/users', response_model=list[UserOut])
def list_users(query: Optional[str] = None, limit: int = 100, offset: int = 0, user=Depends(require_admin_user)):
    return auth_service.list_users(query=query, limit=limit, offset=offset)


@router.delete('/auth/users/cleanup-empty-profile', response_model=UserCleanupOut)
def cleanup_old_users_with_empty_profile(
    older_than_months: int = 1,
    user=Depends(require_admin_user),
):
    return auth_service.delete_old_users_with_empty_profile(older_than_months=older_than_months)


@router.get('/auth/audit-log', response_model=list[AuthAuditLogOut])
def get_auth_audit_log(
    query: Optional[str] = None,
    event_type: Optional[str] = None,
    success: Optional[bool] = None,
    limit: int = 100,
    offset: int = 0,
    user=Depends(require_admin_user),
):
    return auth_service.list_auth_audit_logs(
        query=query,
        event_type=event_type,
        success=success,
        limit=limit,
        offset=offset,
    )


@router.delete('/auth/audit-log', response_model=AuthAuditLogCleanupOut)
def cleanup_auth_audit_log(
    older_than_months: int = 3,
    user=Depends(require_admin_user),
):
    return auth_service.delete_old_auth_audit_logs(older_than_months=older_than_months)


@router.get('/auth/users/{user_id}', response_model=UserOut)
def get_user(user_id: int, user=Depends(require_admin_user)):
    u = auth_service.admin_get_user(user_id)
    if not u:
        raise HTTPException(status_code=404, detail='User not found')
    return u


@router.put('/auth/users/{user_id}')
def update_user(user_id: int, payload: UserUpdateIn, user=Depends(require_admin_user)):
    ok = auth_service.admin_update_user(user_id, payload.model_dump())
    if not ok:
        raise HTTPException(status_code=400, detail='Could not update user (username may be taken)')
    return {'status': 'ok'}


@router.post('/auth/users/{user_id}/password')
def set_user_password(user_id: int, payload: PasswordIn, user=Depends(require_admin_user)):
    password_error = validate_password_strength(payload.new_password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)
    ok = auth_service.admin_set_password(user_id, payload.new_password)
    if not ok:
        raise HTTPException(status_code=400, detail='Could not set password')
    return {'status': 'ok'}


@router.delete('/auth/users/{user_id}')
def delete_user(user_id: int, user=Depends(require_admin_user)):
    ok = auth_service.admin_delete_user(user_id)
    if not ok:
        raise HTTPException(status_code=404, detail='User not found')
    return {'status': 'ok'}
