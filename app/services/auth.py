from datetime import datetime, timedelta, timezone
from typing import Optional
import logging
import secrets

from jose import jwt
from sqlalchemy import desc, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

import app.config as app_config
from app.db.session import get_session
from app.db.models.users import AuthAuditLog, RefreshToken, Role, User, UserPerson, UserProfile
from app.services.password_utils import pwd_context, verify_password, hash_password

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"
TOKEN_AUDIENCE = ['astronex:auth']

PERSON_FIELDS = [
    'role_id',
    'name',
    'residence_country',
    'residence_region',
    'residence_city',
    'residence_latitude',
    'residence_longitude',
    'birth_year',
    'birth_month',
    'birth_day',
    'birth_hour',
    'birth_minute',
    'birth_second',
    'birth_country',
    'birth_region',
    'birth_city',
    'birth_latitude',
    'birth_longitude',
    'birth_timezone',
    'residence_timezone',
]
PERSON_SELECT_COLUMNS = ['id'] + PERSON_FIELDS
PERSON_INSERT_COLUMNS = ['user_id'] + PERSON_FIELDS


def _coerce_role_id(value):
    """Coerce a value to a valid role_id (default 1 if invalid).

    Args:
        value: The value to coerce to a role_id.

    Returns:
        Integer role_id (default 1).
    """
    try:
        return int(value) if value is not None else 1
    except (TypeError, ValueError):
        return 1


def _profile_can_manage_roles(profile_row: Optional[UserProfile]) -> bool:
    """Check if a user profile can manage roles (admin or poweruser).

    Args:
        profile_row: UserProfile database row.

    Returns:
        True if profile can manage roles, False otherwise.
    """
    return bool(profile_row and (getattr(profile_row, 'isadmin', False) or getattr(profile_row, 'is_poweruser', False)))


def list_roles():
    """List all available roles ordered by role_id.

    Returns:
        List of dicts with role_id and role_name.
    """
    session = get_session()
    try:
        rows = session.query(Role).order_by(Role.role_id).all()
    finally:
        session.close()
    return [
        {
            "role_id": row.role_id,
            "role_name": row.role_name,
        }
        for row in rows
    ]


def get_role_by_id(role_id: int) -> Optional[dict]:
    """Get a role by its ID.

    Args:
        role_id: The role ID to look up.

    Returns:
        Dict with role_id and role_name, or None if not found.
    """
    session = get_session()
    try:
        row = session.query(Role).filter(Role.role_id == role_id).first()
    finally:
        session.close()
    if not row:
        return None
    return {
        "role_id": row.role_id,
        "role_name": row.role_name,
    }


def get_role_name_for_subject(user_id: int, person_id: Optional[int] = None) -> str:
    """Get the role name for a user, optionally for a specific person.

    Args:
        user_id: The user ID.
        person_id: Optional person ID to get role for (if user has multiple persons).

    Returns:
        Role name string (e.g., "Laie", "Fortgeschritten", "Experte").
    """
    if person_id is not None:
        person = get_person(user_id, int(person_id))
        role_id = person.get('role_id', 1) if person else 1
    else:
        profile = get_profile(user_id) or {}
        role_id = profile.get('role_id', 1)

    role = get_role_by_id(role_id)
    if role:
        return role.get('role_name') or 'Laie'
    return 'Laie'


def revoke_user_token_by_user_id(user_id: str):
    """Revoke all refresh tokens for a user.

    Args:
        user_id: The user ID to revoke tokens for.
    """
    session = get_session()
    try:
        session.query(RefreshToken).filter(RefreshToken.user_id == int(user_id)).delete()
        session.commit()
    finally:
        session.close()


def revoke_user_token_by_token(token: str):
    """Revoke a specific refresh token.

    Args:
        token: The refresh token to revoke.
    """
    session = get_session()
    try:
        session.query(RefreshToken).filter(RefreshToken.token == token).delete()
        session.commit()
    finally:
        session.close()


def get_password_hash(password: str) -> str:
    """Hash a password using bcrypt.

    Args:
        password: Plain text password to hash.

    Returns:
        Hashed password string.
    """
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a bcrypt hash.

    Args:
        plain_password: Plain text password to verify.
        hashed_password: bcrypt hash to verify against.

    Returns:
        True if password matches, False otherwise.
    """
    return pwd_context.verify(plain_password, hashed_password)


def create_user(username: str, password: str) -> bool:
    """Create a new user with username and password.

    Args:
        username: Desired username.
        password: Plain text password (will be hashed).

    Returns:
        True if user created successfully, False if username exists.
    """
    session = get_session()
    try:
        user = User(username=username, password_hash=get_password_hash(password))
        session.add(user)
        session.commit()
        return True
    except IntegrityError:
        session.rollback()
        return False
    finally:
        session.close()


def authenticate_user(username: str, password: str) -> Optional[dict]:
    """Authenticate a user with username and password.

    Args:
        username: Username to authenticate.
        password: Plain text password to verify.

    Returns:
        Dict with id and username if successful, None otherwise.
    """
    session = get_session()
    try:
        user = session.query(User).filter(User.username == username).first()
    finally:
        session.close()
    if not user:
        return None
    uid, uname, phash = user.id, user.username, user.password_hash
    if not verify_password(password, phash):
        return None
    return {"id": uid, "username": uname}


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token.

    Args:
        data: Dict of claims to encode in the token.
        expires_delta: Optional expiration timedelta. Defaults to config setting.

    Returns:
        Encoded JWT string.
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=app_config.ACCESS_TOKEN_EXPIRE_MINUTES)
    # Add unique token ID for blacklist tracking (AUTH-03)
    if "jti" not in to_encode:
        to_encode["jti"] = secrets.token_urlsafe(16)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, app_config.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_refresh_token(user_id: int, days: int = 7) -> str:
    """Create a refresh token for a user.

    Args:
        user_id: The user ID to create token for.
        days: Number of days until expiration (default 7).

    Returns:
        Token string, or None on failure.
    """
    session = get_session()
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    try:
        row = RefreshToken(user_id=user_id, token=token, expires_at=expires)
        session.add(row)
        session.commit()
        return token
    except Exception as e:
        logger.exception(f"Failed to create refresh token for user {user_id}: {e}")
        session.rollback()
        return None
    finally:
        session.close()


def verify_refresh_token(token: str) -> Optional[int]:
    """Verify a refresh token and return the user ID if valid.

    Args:
        token: The refresh token to verify.

    Returns:
        User ID if token is valid and not expired, None otherwise.
    """
    session = get_session()
    try:
        row = session.query(RefreshToken).filter(RefreshToken.token == token).first()
    finally:
        session.close()
    if not row:
        return None
    user_id, expires_at = row.user_id, row.expires_at
    try:
        exp = datetime.fromisoformat(expires_at)
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > exp:
            return None
        return user_id
    except Exception as e:
        logger.warning(f"Failed to verify refresh token: {e}")
        return None


def revoke_refresh_token(token: str):
    """Revoke a specific refresh token.

    Args:
        token: The refresh token to revoke.
    """
    revoke_user_token_by_token(token)


def revoke_user_refresh_tokens(user_id: int):
    """Revoke all refresh tokens for a user.

    Args:
        user_id: The user ID to revoke tokens for.
    """
    revoke_user_token_by_user_id(user_id)


def get_user_by_id(user_id: int) -> Optional[dict]:
    """Get user by ID.

    Args:
        user_id: The user ID to look up.

    Returns:
        Dict with id and username, or None if not found.
    """
    session = get_session()
    try:
        row = session.query(User).filter(User.id == user_id).first()
    finally:
        session.close()
    if not row:
        return None
    return {"id": row.id, "username": row.username}


def is_poweruser(user_id: int) -> bool:
    """Check if a user has poweruser status.

    Args:
        user_id: The user ID to check.

    Returns:
        True if user is a poweruser, False otherwise.
    """
    session = get_session()
    try:
        prof = session.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        return bool(getattr(prof, 'is_poweruser', False))
    finally:
        session.close()


def list_users(query: Optional[str] = None, limit: int = 100, offset: int = 0):
    """List users with optional search and pagination.

    Args:
        query: Optional username search filter.
        limit: Maximum number of results.
        offset: Number of results to skip.

    Returns:
        List of user dicts with id, username, role_id, isadmin, is_poweruser, created.
    """
    session = get_session()
    try:
        # Use joinedload to fetch profiles in single query (fixes N+1)
        from sqlalchemy.orm import joinedload
        q = session.query(User).options(joinedload(User.profile))
        if query:
            q = q.filter(func.lower(User.username).like(f"%{query.lower()}%"))
        rows = q.order_by(User.username).limit(limit).offset(offset).all()
        result = []
        for row in rows:
            prof = row.profile  # Already loaded via joinedload
            result.append({
                "id": row.id,
                "username": row.username,
                "role_id": getattr(prof, 'role_id', None) if prof else None,
                "isadmin": bool(getattr(prof, 'isadmin', False)) if prof else False,
                "is_poweruser": bool(getattr(prof, 'is_poweruser', False)) if prof else False,
                "created": row.created,
            })
        return result
    finally:
        session.close()


def list_auth_audit_logs(
    query: Optional[str] = None,
    event_type: Optional[str] = None,
    success: Optional[bool] = None,
    limit: int = 100,
    offset: int = 0,
):
    """List authentication audit logs with optional filters.

    Args:
        query: Optional search filter (username, detail, ip_address).
        event_type: Optional filter by event type.
        success: Optional filter by success status.
        limit: Maximum number of results.
        offset: Number of results to skip.

    Returns:
        List of audit log dicts.
    """
    session = get_session()
    try:
        q = session.query(AuthAuditLog)
        if query:
            query_value = f"%{query.lower()}%"
            q = q.filter(
                func.lower(func.coalesce(AuthAuditLog.username, '')).like(query_value)
                | func.lower(func.coalesce(AuthAuditLog.detail, '')).like(query_value)
                | func.lower(func.coalesce(AuthAuditLog.ip_address, '')).like(query_value)
            )
        if event_type:
            q = q.filter(AuthAuditLog.event_type == event_type)
        if success is not None:
            q = q.filter(AuthAuditLog.success == bool(success))

        rows = (
            q.order_by(desc(AuthAuditLog.created), desc(AuthAuditLog.id))
            .limit(limit)
            .offset(offset)
            .all()
        )
        return [
            {
                'id': row.id,
                'user_id': row.user_id,
                'username': row.username,
                'event_type': row.event_type,
                'success': bool(row.success),
                'ip_address': row.ip_address,
                'user_agent': row.user_agent,
                'detail': row.detail,
                'created': row.created,
            }
            for row in rows
        ]
    finally:
        session.close()


def _subtract_months(value: datetime, months: int) -> datetime:
    """Subtract months from a datetime, capping day to 28 for valid dates.

    Args:
        value: Input datetime.
        months: Number of months to subtract.

    Returns:
        New datetime with months subtracted.
    """
    month_index = value.month - 1 - months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, 28)
    return value.replace(year=year, month=month, day=day)


def delete_old_auth_audit_logs(*, older_than_months: int = 3) -> dict:
    """Delete authentication audit logs older than specified months.

    Args:
        older_than_months: Delete logs older than this many months (default 3).

    Returns:
        Dict with deleted_count, older_than_months, and cutoff timestamp.
    """
    months = max(1, int(older_than_months))
    cutoff = _subtract_months(datetime.now(timezone.utc), months)

    session = get_session()
    try:
        deleted_count = (
            session.query(AuthAuditLog)
            .filter(AuthAuditLog.created < cutoff)
            .delete(synchronize_session=False)
        )
        session.commit()
        return {
            'deleted_count': int(deleted_count or 0),
            'older_than_months': months,
            'cutoff': cutoff,
        }
    finally:
        session.close()


def delete_old_users_with_empty_profile(*, older_than_months: int = 1) -> dict:
    """Delete users older than specified months with empty/incomplete profiles.

    Args:
        older_than_months: Delete users older than this many months (default 1).

    Returns:
        Dict with deleted_count, older_than_months, and cutoff timestamp.
    """
    months = max(1, int(older_than_months))
    cutoff = _subtract_months(datetime.now(timezone.utc), months)

    session = get_session()
    try:
        user_ids = [
            row.id
            for row in (
                session.query(User.id)
                .outerjoin(UserProfile, UserProfile.user_id == User.id)
                .filter(User.created < cutoff)
                .filter((UserProfile.user_id.is_(None)) | (UserProfile.birth_year.is_(None)))
                .all()
            )
        ]

        if not user_ids:
            return {
                'deleted_count': 0,
                'older_than_months': months,
                'cutoff': cutoff,
            }

        session.query(RefreshToken).filter(RefreshToken.user_id.in_(user_ids)).delete(synchronize_session=False)
        session.query(UserPerson).filter(UserPerson.user_id.in_(user_ids)).delete(synchronize_session=False)
        session.query(UserProfile).filter(UserProfile.user_id.in_(user_ids)).delete(synchronize_session=False)
        deleted_count = session.query(User).filter(User.id.in_(user_ids)).delete(synchronize_session=False)
        session.commit()
        return {
            'deleted_count': int(deleted_count or 0),
            'older_than_months': months,
            'cutoff': cutoff,
        }
    finally:
        session.close()


def admin_get_user(user_id: int) -> Optional[dict]:
    """Get user details for admin purposes.

    Args:
        user_id: The user ID to retrieve.

    Returns:
        Dict with user details or None if not found.
    """
    session = get_session()
    try:
        row = session.query(User).filter(User.id == user_id).first()
        prof = session.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    finally:
        session.close()
    if not row:
        return None
    return {
        "id": row.id,
        "username": row.username,
        "role_id": getattr(prof, 'role_id', None) if prof else None,
        "isadmin": bool(getattr(prof, 'isadmin', False)) if prof else False,
        "is_poweruser": bool(getattr(prof, 'is_poweruser', False)) if prof else False,
        "created": row.created,
    }


def admin_update_user(user_id: int, data: dict) -> bool:
    """Update user fields as admin (username, role, admin status, poweruser status).

    Args:
        user_id: The user ID to update.
        data: Dict with fields to update.

    Returns:
        True if updated successfully, False if user not found or IntegrityError.
    """
    session = get_session()
    try:
        row = session.query(User).filter(User.id == user_id).first()
        if not row:
            return False
        if data.get('username'):
            row.username = data.get('username')
        session.add(row)
        prof = session.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        if not prof:
            prof = UserProfile(user_id=user_id)
        if 'role_id' in data:
            prof.role_id = _coerce_role_id(data.get('role_id'))
        if 'isadmin' in data:
            prof.isadmin = bool(data.get('isadmin'))
        if 'is_poweruser' in data:
            prof.is_poweruser = bool(data.get('is_poweruser'))
        session.add(prof)
        session.commit()
        return True
    except IntegrityError:
        session.rollback()
        return False
    finally:
        session.close()


def admin_delete_user(user_id: int) -> bool:
    """Delete a user and all related data (tokens, profiles, persons).

    Args:
        user_id: The user ID to delete.

    Returns:
        True if user was deleted, False if not found.
    """
    session = get_session()
    try:
        session.query(RefreshToken).filter(RefreshToken.user_id == user_id).delete()
        session.query(UserPerson).filter(UserPerson.user_id == user_id).delete()
        session.query(UserProfile).filter(UserProfile.user_id == user_id).delete()
        rows = session.query(User).filter(User.id == user_id).delete()
        session.commit()
        return rows > 0
    finally:
        session.close()


def admin_set_password(user_id: int, new_password: str) -> bool:
    """Set a new password for a user (admin function).

    Args:
        user_id: The user ID to set password for.
        new_password: New plain text password.

    Returns:
        True if password set successfully, False if user not found.
    """
    session = get_session()
    try:
        row = session.query(User).filter(User.id == user_id).first()
        if not row:
            return False
        row.password_hash = get_password_hash(new_password)
        session.add(row)
        session.commit()
        return True
    finally:
        session.close()


def change_password(user_id: int, old_password: str, new_password: str) -> bool:
    """Change a user's password with old password verification.

    Args:
        user_id: The user ID.
        old_password: Current password for verification.
        new_password: New password to set.

    Returns:
        True if password changed successfully, False if verification fails or user not found.
    """
    session = get_session()
    row = session.query(User).filter(User.id == user_id).first()
    if not row:
        session.close()
        return False
    phash = row.password_hash
    if not verify_password(old_password, phash):
        session.close()
        return False
    row.password_hash = get_password_hash(new_password)
    session.add(row)
    session.commit()
    session.close()
    return True


def get_profile(user_id: int) -> Optional[dict]:
    """Get user profile data.

    Args:
        user_id: The user ID to get profile for.

    Returns:
        Dict with profile fields or None if profile doesn't exist.
    """
    keys = ["role_id","birth_year","birth_month","birth_day","birth_hour","birth_minute","birth_second","birth_latitude","birth_longitude","birth_place","birth_country","birth_region","birth_city","birth_timezone","residence_latitude","residence_longitude","residence_place","residence_country","residence_region","residence_city","residence_timezone","isadmin","is_poweruser"]
    session = get_session()
    try:
        row = session.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    finally:
        session.close()
    if not row:
        return None
    result = {k: getattr(row, k) for k in keys}
    result['id'] = user_id
    return result


def update_profile(user_id: int, profile: dict) -> bool:
    """Update user profile with birth and residence data.

    Args:
        user_id: The user ID to update.
        profile: Dict with profile fields to update.

    Returns:
        True if updated successfully.
    """
    session = get_session()
    tzname = profile.get('birth_timezone')
    res_tz = profile.get('residence_timezone')
    try:
        if not tzname and profile.get('birth_latitude') is not None and profile.get('birth_longitude') is not None:
            try:
                from timezonefinder import TimezoneFinder
                tf = TimezoneFinder()
                lat = float(profile.get('birth_latitude'))
                lng = float(profile.get('birth_longitude'))
                tzname = tf.timezone_at(lat=lat, lng=lng)
                if not tzname:
                    # fallback to closest
                    tzname = tf.closest_timezone_at(lat=lat, lng=lng)
            except Exception as e:
                logger.debug(f"Failed to get birth timezone: {e}")
                tzname = None
        # residence timezone fallback
        if not res_tz and profile.get('residence_latitude') is not None and profile.get('residence_longitude') is not None:
            try:
                from timezonefinder import TimezoneFinder
                tf2 = TimezoneFinder()
                rlat = float(profile.get('residence_latitude'))
                rlng = float(profile.get('residence_longitude'))
                res_tz = tf2.timezone_at(lat=rlat, lng=rlng)
                if not res_tz:
                    res_tz = tf2.closest_timezone_at(lat=rlat, lng=rlng)
            except Exception as e:
                logger.debug(f"Failed to get residence timezone: {e}")
                res_tz = None
    except Exception as e:
        logger.debug(f"Failed to get user timezone: {e}")
        tzname = None

    row = session.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    can_manage_roles = _profile_can_manage_roles(row)
    if not row:
        row = UserProfile(user_id=user_id)
    if can_manage_roles:
        row.role_id = _coerce_role_id(profile.get('role_id'))
    row.birth_year = profile.get('birth_year')
    row.birth_month = profile.get('birth_month')
    row.birth_day = profile.get('birth_day')
    row.birth_hour = profile.get('birth_hour')
    row.birth_minute = profile.get('birth_minute')
    row.birth_second = profile.get('birth_second')
    row.birth_latitude = profile.get('birth_latitude')
    row.birth_longitude = profile.get('birth_longitude')
    row.birth_place = profile.get('birth_place')
    row.birth_country = profile.get('birth_country')
    row.birth_region = profile.get('birth_region')
    row.birth_city = profile.get('birth_city')
    row.birth_timezone = tzname
    row.residence_latitude = profile.get('residence_latitude')
    row.residence_longitude = profile.get('residence_longitude')
    row.residence_place = profile.get('residence_place')
    row.residence_country = profile.get('residence_country')
    row.residence_region = profile.get('residence_region')
    row.residence_city = profile.get('residence_city')
    row.residence_timezone = res_tz
    session.add(row)
    session.commit()
    session.close()
    return True


def _person_row_to_dict(row):
    """Convert a UserPerson database row to a dict.

    Args:
        row: UserPerson database row.

    Returns:
        Dict with person fields or None if row is None.
    """
    if not row:
        return None
    return {k: getattr(row, k) for k in PERSON_SELECT_COLUMNS}


def list_persons(user_id: int):
    """List all persons (birth profiles) for a user.

    Args:
        user_id: The user ID to list persons for.

    Returns:
        List of person dicts ordered by name.
    """
    session = get_session()
    rows = (
        session.query(UserPerson)
        .filter(UserPerson.user_id == user_id)
        .order_by(func.lower(UserPerson.name))
        .all()
    )
    session.close()
    return [_person_row_to_dict(row) for row in rows if row]


def get_person(user_id: int, person_id: int):
    """Get a specific person by ID for a user.

    Args:
        user_id: The user ID.
        person_id: The person ID to retrieve.

    Returns:
        Person dict or None if not found.
    """
    session = get_session()
    row = (
        session.query(UserPerson)
        .filter(UserPerson.user_id == user_id, UserPerson.id == person_id)
        .first()
    )
    session.close()
    return _person_row_to_dict(row)


def create_person(user_id: int, person: dict):
    """Create a new person (birth profile) for a user.

    Args:
        user_id: The user ID to create person for.
        person: Dict with person fields (name, birth data, residence, etc.).

    Returns:
        New person ID if created, None on IntegrityError.
    """
    session = get_session()
    try:
        actor_profile = session.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        can_manage_roles = _profile_can_manage_roles(actor_profile)
        row = UserPerson(user_id=user_id)
        for col in PERSON_FIELDS:
            if col == 'role_id':
                value = _coerce_role_id(person.get(col)) if can_manage_roles else 1
            else:
                value = person.get(col)
            setattr(row, col, value)
        session.add(row)
        session.commit()
        return row.id
    except IntegrityError:
        session.rollback()
        return None
    finally:
        session.close()


def update_person(user_id: int, person_id: int, person: dict) -> bool:
    """Update an existing person (birth profile) for a user.

    Args:
        user_id: The user ID.
        person_id: The person ID to update.
        person: Dict with fields to update.

    Returns:
        True if updated successfully, False if not found.
    """
    session = get_session()
    actor_profile = session.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    can_manage_roles = _profile_can_manage_roles(actor_profile)
    row = (
        session.query(UserPerson)
        .filter(UserPerson.user_id == user_id, UserPerson.id == person_id)
        .first()
    )
    if not row:
        session.close()
        return False
    for col in PERSON_FIELDS:
        if col == 'role_id':
            if can_manage_roles:
                row.role_id = _coerce_role_id(person.get(col))
        elif person.get(col) is not None:
            setattr(row, col, person.get(col))
    session.add(row)
    session.commit()
    session.close()
    return True


def delete_person(user_id: int, person_id: int) -> bool:
    """Delete a person (birth profile) for a user.

    Args:
        user_id: The user ID.
        person_id: The person ID to delete.

    Returns:
        True if deleted, False if not found.
    """
    session = get_session()
    rows = (
        session.query(UserPerson)
        .filter(UserPerson.user_id == user_id, UserPerson.id == person_id)
        .delete()
    )
    session.commit()
    session.close()
    success = rows > 0
    return success


def user_to_dict(user: User) -> dict:
    """Convert a User model to a dict.

    Args:
        user: User database model.

    Returns:
        Dict with id, username, isadmin, is_poweruser.
    """
    return {
        'id': user.id,
        'username': user.username,
        'isadmin': bool(user.is_superuser),
        'is_poweruser': bool(user.is_poweruser),
    }


async def authenticate_by_username(username: str, password: str) -> Optional[User]:
    """Authenticate a user by username and password (async).

    Args:
        username: Username to authenticate.
        password: Plain text password to verify.

    Returns:
        User object if authenticated, None otherwise.
    """
    session = get_session()
    try:
        user = session.query(User).filter(User.username == username.strip()).first()
        if user is None:
            return None
        verified, _ = pwd_context.verify_and_update(password, user.hashed_password)
        if not verified:
            return None
        return user
    finally:
        session.close()


async def create_user_with_username(username: str, password: str, is_superuser: bool = False) -> User:
    """Create a new user with username and password (async).

    Args:
        username: Desired username.
        password: Plain text password.
        is_superuser: Whether to grant admin/superuser status.

    Returns:
        Created User object.

    Raises:
        UserAlreadyExists: If username already exists.
    """
    session = get_session()
    try:
        existing = session.query(User).filter(User.username == username.strip()).first()
        if existing is not None:
            from fastapi_users import exceptions as fu_exc
            raise fu_exc.UserAlreadyExists()
        hashed = pwd_context.hash(password)
        user = User(username=username.strip(), password_hash=hashed)
        session.add(user)
        session.flush()
        profile = UserProfile(user_id=user.id, isadmin=bool(is_superuser))
        session.add(profile)
        session.commit()
        session.refresh(user)
        return user
    except IntegrityError:
        session.rollback()
        from fastapi_users import exceptions as fu_exc
        raise fu_exc.UserAlreadyExists()
    finally:
        session.close()


async def get_user_by_id_async(user_id: int) -> Optional[User]:
    """Get a user by ID with profile loaded (async).

    Args:
        user_id: The user ID to retrieve.

    Returns:
        User object with profile, or None if not found.
    """
    session = get_session()
    try:
        return session.query(User).options(joinedload(User.profile)).filter(User.id == user_id).first()
    finally:
        session.close()


async def issue_access_token(user: User) -> str:
    """Issue a JWT access token for a user (async).

    Args:
        user: User object to issue token for.

    Returns:
        JWT token string.
    """
    from app.services.fastapi_users import get_jwt_strategy
    return await get_jwt_strategy().write_token(user)
