from __future__ import annotations
from sqlalchemy import Column, Integer, String, Text, Float, Boolean, text, DateTime, func
from sqlalchemy.orm import relationship, foreign
from app.db.session import Base


class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True, autoincrement=True)
    created = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    username = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)

    profile = relationship(
        'UserProfile',
        uselist=False,
        back_populates='user',
        primaryjoin='User.id == foreign(UserProfile.user_id)',
    )

    @property
    def email(self):
        return self.username

    @email.setter
    def email(self, value):
        self.username = value

    @property
    def hashed_password(self):
        return self.password_hash

    @hashed_password.setter
    def hashed_password(self, value):
        self.password_hash = value

    @property
    def is_active(self):
        return True

    @is_active.setter
    def is_active(self, value):
        return None

    @property
    def is_verified(self):
        return True

    @is_verified.setter
    def is_verified(self, value):
        return None

    @property
    def is_superuser(self):
        return bool(self.profile.isadmin) if self.profile else False

    @is_superuser.setter
    def is_superuser(self, value):
        if self.profile is None:
            self.profile = UserProfile(user_id=self.id)
        self.profile.isadmin = bool(value)

    @property
    def is_poweruser(self):
        return bool(self.profile.is_poweruser) if self.profile else False

    @is_poweruser.setter
    def is_poweruser(self, value):
        if self.profile is None:
            self.profile = UserProfile(user_id=self.id)
        self.profile.is_poweruser = bool(value)


class UserProfile(Base):
    __tablename__ = 'user_profiles'
    user_id = Column(Integer, primary_key=True)
    role_id = Column(Integer, nullable=False, default=1, server_default=text('1'))
    birth_year = Column(Integer)
    birth_month = Column(Integer)
    birth_day = Column(Integer)
    birth_hour = Column(Integer)
    birth_minute = Column(Integer)
    birth_second = Column(Integer)
    birth_latitude = Column(Float)
    birth_longitude = Column(Float)
    birth_place = Column(Text)
    birth_country = Column(Text)
    birth_region = Column(Text)
    birth_city = Column(Text)
    birth_timezone = Column(Text)
    residence_latitude = Column(Float)
    residence_longitude = Column(Float)
    residence_place = Column(Text)
    residence_country = Column(Text)
    residence_region = Column(Text)
    residence_city = Column(Text)
    residence_timezone = Column(Text)
    isadmin = Column(Boolean, default=False)
    is_poweruser = Column(Boolean, nullable=False, default=False, server_default=text('false'))

    user = relationship(
        'User',
        back_populates='profile',
        primaryjoin='foreign(UserProfile.user_id) == User.id',
    )


class UserPerson(Base):
    __tablename__ = 'user_persons'
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False)
    role_id = Column(Integer, nullable=False, default=1, server_default=text('1'))
    name = Column(Text, nullable=False)
    residence_country = Column(Text)
    residence_region = Column(Text)
    residence_city = Column(Text)
    residence_latitude = Column(Float)
    residence_longitude = Column(Float)
    birth_year = Column(Integer)
    birth_month = Column(Integer)
    birth_day = Column(Integer)
    birth_hour = Column(Integer)
    birth_minute = Column(Integer)
    birth_second = Column(Integer)
    birth_country = Column(Text)
    birth_region = Column(Text)
    birth_city = Column(Text)
    birth_latitude = Column(Float)
    birth_longitude = Column(Float)


class RefreshToken(Base):
    __tablename__ = 'refresh_tokens'
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False)
    token = Column(String, unique=True, nullable=False)
    expires_at = Column(String, nullable=False)


class Role(Base):
    __tablename__ = 'roles'
    role_id = Column(Integer, primary_key=True)
    role_name = Column(Text)


class AuthAuditLog(Base):
    __tablename__ = 'auth_audit_logs'

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer)
    username = Column(String)
    event_type = Column(String(64), nullable=False)
    success = Column(Boolean, nullable=False, default=False, server_default=text('false'))
    ip_address = Column(String(128))
    user_agent = Column(Text)
    detail = Column(Text)
    created = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
