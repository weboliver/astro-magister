from __future__ import annotations

from sqlalchemy import Column, Integer, String

from app.db.session import Base


class AppSetting(Base):
    __tablename__ = 'app_settings'

    id = Column(Integer, primary_key=True, autoincrement=True)
    setting_name = Column(String, unique=True, nullable=False)
    setting_value = Column(String, nullable=True)
