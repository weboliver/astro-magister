from datetime import datetime, timedelta, timezone
from typing import Optional
import secrets

from jose import jwt
from sqlalchemy import desc, func
from sqlalchemy.exc import IntegrityError

import app.config as app_config
from app.db.session import get_session
from app.db.models.users import AuthAuditLog, RefreshToken, Role, User, UserPerson, UserProfile
from app.services.password_utils import pwd_context, verify_password, hash_password

ALGORITHM = "HS256"

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
]
PERSON_SELECT_COLUMNS = ['id'] + PERSON_FIELDS
PERSON_INSERT_COLUMNS = ['user_id'] + PERSON_FIELDS


def _coerce_role_id(value):
    try:
        return int(value) if value is not None else 1
    except (TypeError, ValueError):
        return 1


def _profile_can_manage_roles(profile_row: Optional[UserProfile]) -> bool:
    return bool(profile_row and (getattr(profile_row, 'isadmin', False) or getattr(profile_row, 'is_poweruser', False)))


def list_roles():
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
    session = get_session()
    try:
        session.query(RefreshToken).filter(RefreshToken.user_id == int(user_id)).delete()
        session.commit()
    finally:
        session.close()

def revoke_user_token_by_token(token: str):
    session = get_session()
    try:
        session.query(RefreshToken).filter(RefreshToken.token == token).delete()
        session.commit()
    finally:
        session.close()

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_user(username: str, password: str) -> bool:
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
    revoke_user_token_by_token(token)


def revoke_user_refresh_tokens(user_id: int):
    revoke_user_token_by_user_id(user_id)


def get_user_by_id(user_id: int) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(User).filter(User.id == user_id).first()
    finally:
        session.close()
    if not row:
        return None
    return {"id": row.id, "username": row.username}


def list_users(query: Optional[str] = None, limit: int = 100, offset: int = 0):
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
    month_index = value.month - 1 - months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, 28)
    return value.replace(year=year, month=month, day=day)


def delete_old_auth_audit_logs(*, older_than_months: int = 3) -> dict:
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
    if not row:
        return None
    return {k: getattr(row, k) for k in PERSON_SELECT_COLUMNS}


def list_persons(user_id: int):
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
    session = get_session()
    row = (
        session.query(UserPerson)
        .filter(UserPerson.user_id == user_id, UserPerson.id == person_id)
        .first()
    )
    session.close()
    return _person_row_to_dict(row)


def create_person(user_id: int, person: dict):
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
            value = _coerce_role_id(person.get(col)) if can_manage_roles else row.role_id
        else:
            value = person.get(col)
        setattr(row, col, value)
    session.add(row)
    session.commit()
    session.close()
    success = True
    return success


def delete_person(user_id: int, person_id: int) -> bool:
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
