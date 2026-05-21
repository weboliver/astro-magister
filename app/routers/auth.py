from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError

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
from app.services.jwt_blacklist import blacklist_token, is_token_blacklisted
from app.services.auth import (
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
    """Generate cookie settings dict for auth cookies.

    Args:
        max_age: Cookie max age in seconds.

    Returns:
        Dictionary with cookie settings (httponly, secure, samesite, max_age, path, domain).
    """
    return {
        'httponly': True,
        'secure': COOKIE_SECURE,
        'samesite': COOKIE_SAMESITE,
        'max_age': max_age,
        'path': '/',
        'domain': COOKIE_DOMAIN,
    }


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    """Set authentication cookies on the response.

    Args:
        response: FastAPI Response object.
        access_token: JWT access token string.
        refresh_token: Refresh token string.
    """
    response.set_cookie(ACCESS_COOKIE_NAME, access_token, **_cookie_settings(app_config.ACCESS_TOKEN_EXPIRE_MINUTES * 60))
    response.set_cookie(REFRESH_COOKIE_NAME, refresh_token, **_cookie_settings(REFRESH_TOKEN_MAX_AGE_SECONDS))


def _clear_auth_cookies(response: Response) -> None:
    """Clear authentication cookies from the response.

    Args:
        response: FastAPI Response object.
    """
    response.delete_cookie(ACCESS_COOKIE_NAME, path='/', domain=COOKIE_DOMAIN)
    response.delete_cookie(REFRESH_COOKIE_NAME, path='/', domain=COOKIE_DOMAIN)


def _rate_limit_exception(detail: str, retry_after_seconds: int) -> HTTPException:
    """Create a rate limit HTTP exception.

    Args:
        detail: Error message detail.
        retry_after_seconds: Seconds until rate limit resets.

    Returns:
        HTTPException with 429 status and Retry-After header.
    """
    return HTTPException(status_code=429, detail=detail, headers={'Retry-After': str(retry_after_seconds)})


def _lockout_exception(retry_after_seconds: int) -> HTTPException:
    """Create an account lockout HTTP exception.

    Args:
        retry_after_seconds: Seconds until lockout expires.

    Returns:
        HTTPException with 423 status and Retry-After header.
    """
    return HTTPException(
        status_code=423,
        detail='Zu viele Fehlversuche. Der Zugang ist für 1 Stunde gesperrt. Bitte später erneut versuchen.',
        headers={'Retry-After': str(retry_after_seconds)},
    )


def _resolve_refresh_token(payload: RefreshIn | LogoutIn | None, request: Request) -> Optional[str]:
    """Resolve refresh token from request body or cookies.

    Args:
        payload: Optional request body with refresh_token field.
        request: FastAPI Request object.

    Returns:
        Refresh token string or None if not found.
    """
    if payload and payload.refresh_token:
        return payload.refresh_token
    return request.cookies.get(REFRESH_COOKIE_NAME)


def _unauthorized_exception() -> HTTPException:
    """Create an unauthorized HTTP exception.

    Returns:
        HTTPException with 401 status and WWW-Authenticate header.
    """
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail='Unauthorized',
        headers={'WWW-Authenticate': 'Bearer'},
    )

@router.post('/auth/register', status_code=201)
async def register(payload: RegisterIn, request: Request):
    """Register a new user account.

    Args:
        payload: RegisterIn with username, password, and captcha_token.
        request: FastAPI Request for client IP and user agent.

    Returns:
        Dict with registered username.

    Raises:
        HTTPException: On rate limit, weak password, invalid captcha, or user exists.
    """
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
    """Login with username and password.

    Args:
        payload: LoginIn with username, password, and captcha_token.
        request: FastAPI Request for client IP and user agent.
        response: FastAPI Response to set auth cookies.

    Returns:
        Token dict with access_token, token_type, and refresh_token.

    Raises:
        HTTPException: On lockout, rate limit, captcha failure, or invalid credentials.
    """
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
    """Refresh access token using a valid refresh token.

    Args:
        request: FastAPI Request for client IP and user agent.
        response: FastAPI Response to set new auth cookies.
        payload: Optional RefreshIn with refresh_token in body.

    Returns:
        Token dict with new access_token, token_type, and refresh_token.

    Raises:
        HTTPException: On rate limit, invalid/expired refresh token, or user not found.
    """
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
    """Logout by clearing refresh token (without blacklisting access token).

    Args:
        request: FastAPI Request to get refresh token from cookies.
        response: FastAPI Response to clear auth cookies.
        payload: Optional LogoutIn with refresh_token in body.

    Returns:
        Dict with status 'ok'.
    """
    refresh_token_value = _resolve_refresh_token(payload, request)
    if refresh_token_value:
        auth_service.revoke_refresh_token(refresh_token_value)
    _clear_auth_cookies(response)
    return {'status':'ok'}


def _get_user_from_request(request: Request):
    """Extract user from request Authorization header or cookies.

    Args:
        request: FastAPI Request with Authorization header or access cookie.

    Returns:
        User dict if valid token found, None otherwise.
    """
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
    """Decode JWT token and retrieve user.

    Args:
        token: JWT access token string.

    Returns:
        User dict if token valid and not blacklisted, None otherwise.
    """
    try:
        data = jwt.decode(
            token,
            app_config.SECRET_KEY,
            algorithms=[app_config.ALGORITHM if hasattr(app_config,'ALGORITHM') else 'HS256'],
            audience=TOKEN_AUDIENCE[0],
        )
    except JWTError:
        return None
    # AUTH-03: Check if token is blacklisted
    token_jti = data.get('jti')
    if token_jti and is_token_blacklisted(token_jti):
        return None
    uid = data.get('sub')
    if uid:
        return auth_service.get_user_by_id(int(uid))
    return None


def require_authenticated_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
):
    """Dependency to require authenticated user.

    Args:
        request: FastAPI Request to check cookies.
        credentials: Optional HTTPBearer credentials from Authorization header.

    Returns:
        User dict for authenticated user.

    Raises:
        HTTPException: If user not authenticated.
    """
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
    """Dependency to require admin user.

    Args:
        user: User dict from require_authenticated_user.

    Returns:
        User dict if admin, otherwise raises 403.

    Raises:
        HTTPException: If user is not admin.
    """
    prof = auth_service.get_profile(user['id']) or {}
    if not prof.get('isadmin'):
        raise HTTPException(status_code=403, detail='Forbidden')
    return user


@router.get('/auth/admin/provider-config', response_model=ProviderConfigOut)
def get_provider_config(user=Depends(require_admin_user)):
    """Get current chat provider configuration (admin only).

    Returns the active chat_provider and the list of available providers.

    Args:
        user: Admin user from dependency.

    Returns:
        ProviderConfigOut with chat_provider and available_providers.
    """
    from app.services.providers import KNOWN_PROVIDERS
    import os
    from app.db.models.settings import AppSetting
    from app.db.session import get_session
    current = None
    try:
        session = get_session()
        try:
            row = session.query(AppSetting).filter(
                AppSetting.setting_name == 'chat_provider'
            ).first()
            current = row.setting_value if row else None
        finally:
            session.close()
    except Exception:
        pass
    if not current:
        current = os.getenv('CHAT_PROVIDER', 'perplexity').strip().lower()
    return {
        'chat_provider': current,
        'available_providers': list(KNOWN_PROVIDERS),
    }


@router.put('/auth/admin/provider-config', response_model=ProviderConfigOut)
def update_provider_config(payload: ProviderConfigIn, user=Depends(require_admin_user)):
    """Update chat provider configuration (admin only).

    Validates the requested provider against KNOWN_PROVIDERS, persists to
    app_settings, and returns the updated configuration.

    Args:
        payload: ProviderConfigIn with chat_provider field.
        user: Admin user from dependency.

    Returns:
        ProviderConfigOut with updated chat_provider and available_providers.

    Raises:
        HTTPException: If chat_provider is not in available providers list.
    """
    from app.services.providers import KNOWN_PROVIDERS
    from app.db.models.settings import AppSetting
    from app.db.session import get_session

    provider = payload.chat_provider.strip().lower()
    if provider not in KNOWN_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f'Ungültiger Provider: {provider}. '
                   f'Verfügbar: {", ".join(KNOWN_PROVIDERS)}',
        )

    session = get_session()
    try:
        row = session.query(AppSetting).filter(
            AppSetting.setting_name == 'chat_provider'
        ).first()
        if row:
            row.setting_value = provider
        else:
            row = AppSetting(setting_name='chat_provider', setting_value=provider)
            session.add(row)
        session.commit()
    except Exception as e:
        session.rollback()
        raise HTTPException(
            status_code=500,
            detail=f'Provider-Einstellungen konnten nicht gespeichert werden: {e}',
        )
    finally:
        session.close()

    return {
        'chat_provider': provider,
        'available_providers': list(KNOWN_PROVIDERS),
    }


@router.post('/auth/logout')
def logout(request: Request, response: Response, user=Depends(require_authenticated_user)):
    """Logout and invalidate tokens (blacklist access token, revoke refresh tokens).

    Args:
        request: FastAPI Request to get Authorization header.
        response: FastAPI Response to clear auth cookies.
        user: Authenticated user from dependency.

    Returns:
        Dict with status 'ok'.
    """
    # AUTH-04: Invalidate access token immediately
    auth_header = request.headers.get('authorization', '')
    if auth_header.startswith('Bearer '):
        token = auth_header[7:]
        try:
            data = jwt.decode(
                token,
                app_config.SECRET_KEY,
                algorithms=[app_config.ALGORITHM if hasattr(app_config,'ALGORITHM') else 'HS256'],
                options={"verify_aud": False},
            )
            token_jti = data.get('jti')
            if token_jti:
                blacklist_token(token_jti, expires_in_seconds=3600)
        except JWTError:
            pass
    auth_service.revoke_user_refresh_tokens(user['id'])
    _clear_auth_cookies(response)
    return {'status':'ok'}


@router.get('/auth/roles', response_model=list[RoleOut])
def get_roles(user=Depends(require_authenticated_user)):
    """Get list of available roles.

    Args:
        user: Authenticated user from dependency.

    Returns:
        List of RoleOut objects.
    """
    return auth_service.list_roles()


@router.post('/auth/change-password')
def change_password(payload: ChangePasswordIn, user=Depends(require_authenticated_user)):
    """Change user password.

    Args:
        payload: ChangePasswordIn with old_password and new_password.
        user: Authenticated user from dependency.

    Returns:
        Dict with status 'ok'.

    Raises:
        HTTPException: On weak password or incorrect old password.
    """
    password_error = validate_password_strength(payload.new_password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)
    ok = auth_service.change_password(user['id'], payload.old_password, payload.new_password)
    if not ok:
        raise HTTPException(status_code=400, detail='Old password incorrect or error')
    return {'status': 'ok'}


@router.get('/auth/profile', response_model=ProfileOut)
def get_profile(user=Depends(require_authenticated_user)):
    """Get current user profile.

    Args:
        user: Authenticated user from dependency.

    Returns:
        ProfileOut with user profile data.
    """
    prof = auth_service.get_profile(user['id']) or {}
    prof['username'] = user.get('username')
    return prof


@router.put('/auth/profile')
def update_profile(payload: ProfileIn, user=Depends(require_authenticated_user)):
    """Update current user profile.

    Args:
        payload: ProfileIn with profile fields to update.
        user: Authenticated user from dependency.

    Returns:
        Dict with status 'ok'.

    Raises:
        HTTPException: On update failure.
    """
    ok = auth_service.update_profile(user['id'], payload.model_dump())
    if not ok:
        raise HTTPException(status_code=500, detail='Could not update profile')
    return {'status': 'ok'}


@router.get('/auth/users', response_model=list[UserOut])
def list_users(query: Optional[str] = None, limit: int = 100, offset: int = 0, user=Depends(require_admin_user)):
    """List users with optional search query (admin only).

    Args:
        query: Optional search string for username.
        limit: Maximum number of users to return.
        offset: Offset for pagination.
        user: Admin user from dependency.

    Returns:
        List of UserOut objects.
    """
    return auth_service.list_users(query=query, limit=limit, offset=offset)


@router.delete('/auth/users/cleanup-empty-profile', response_model=UserCleanupOut)
def cleanup_old_users_with_empty_profile(
    older_than_months: int = 1,
    user=Depends(require_admin_user),
):
    """Delete users with empty profiles older than specified months (admin only).

    Args:
        older_than_months: Delete users with empty profiles older than this many months.
        user: Admin user from dependency.

    Returns:
        UserCleanupOut with deletion count.
    """
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
    """Get authentication audit logs (admin only).

    Args:
        query: Optional search query.
        event_type: Optional filter by event type.
        success: Optional filter by success boolean.
        limit: Maximum number of logs to return.
        offset: Offset for pagination.
        user: Admin user from dependency.

    Returns:
        List of AuthAuditLogOut objects.
    """
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
    """Delete old authentication audit logs (admin only).

    Args:
        older_than_months: Delete logs older than this many months.
        user: Admin user from dependency.

    Returns:
        AuthAuditLogCleanupOut with deletion count.
    """
    return auth_service.delete_old_auth_audit_logs(older_than_months=older_than_months)


@router.get('/auth/users/{user_id}', response_model=UserOut)
def get_user(user_id: int, user=Depends(require_admin_user)):
    """Get user by ID (admin only).

    Args:
        user_id: User ID to retrieve.
        user: Admin user from dependency.

    Returns:
        UserOut object.

    Raises:
        HTTPException: If user not found.
    """
    u = auth_service.admin_get_user(user_id)
    if not u:
        raise HTTPException(status_code=404, detail='User not found')
    return u


@router.put('/auth/users/{user_id}')
def update_user(user_id: int, payload: UserUpdateIn, user=Depends(require_admin_user)):
    """Update user by ID (admin only).

    Args:
        user_id: User ID to update.
        payload: UserUpdateIn with fields to update.
        user: Admin user from dependency.

    Returns:
        Dict with status 'ok'.

    Raises:
        HTTPException: On update failure (e.g., username taken).
    """
    ok = auth_service.admin_update_user(user_id, payload.model_dump())
    if not ok:
        raise HTTPException(status_code=400, detail='Could not update user (username may be taken)')
    return {'status': 'ok'}


@router.post('/auth/users/{user_id}/password')
def set_user_password(user_id: int, payload: PasswordIn, user=Depends(require_admin_user)):
    """Set user password (admin only).

    Args:
        user_id: User ID to set password for.
        payload: PasswordIn with new_password.
        user: Admin user from dependency.

    Returns:
        Dict with status 'ok'.

    Raises:
        HTTPException: On weak password or failure.
    """
    password_error = validate_password_strength(payload.new_password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)
    ok = auth_service.admin_set_password(user_id, payload.new_password)
    if not ok:
        raise HTTPException(status_code=400, detail='Could not set password')
    return {'status': 'ok'}


@router.delete('/auth/users/{user_id}')
def delete_user(user_id: int, user=Depends(require_admin_user)):
    """Delete user by ID (admin only).

    Args:
        user_id: User ID to delete.
        user: Admin user from dependency.

    Returns:
        Dict with status 'ok'.

    Raises:
        HTTPException: If user not found.
    """
    ok = auth_service.admin_delete_user(user_id)
    if not ok:
        raise HTTPException(status_code=404, detail='User not found')
    return {'status': 'ok'}
