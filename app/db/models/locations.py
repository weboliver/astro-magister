from __future__ import annotations

from sqlalchemy import Column, Integer, String, Text, Float

from app.db.session import Base


class CountryName(Base):
    __tablename__ = 'country_names'
    code = Column(String(2), primary_key=True)
    name = Column(Text, nullable=False)


class WorldAdminRegion(Base):
    __tablename__ = 'world_admin_regions'
    alfa = Column(String(2), primary_key=True)
    code = Column(String(2), primary_key=True)
    name = Column(Text, nullable=False)


class UsaState(Base):
    __tablename__ = 'usa_states'
    alfa = Column(String(2), primary_key=True)
    code = Column(String(2), nullable=True)
    name = Column(Text, nullable=False)


class UsaAdminRegion(Base):
    __tablename__ = 'usa_admin_regions'
    alfa = Column(String(2), primary_key=True)
    state = Column(String(2), primary_key=True)
    code = Column(String(3), primary_key=True)
    name = Column(Text, nullable=False)


class ZoneEntry(Base):
    __tablename__ = 'zone_entries'
    id = Column(Integer, primary_key=True, autoincrement=True)
    alfa = Column(String(2), nullable=False)
    zones = Column(Text, nullable=True)
    name = Column(Text, nullable=False)


class Location(Base):
    __tablename__ = 'locations'
    id = Column(Integer, primary_key=True, autoincrement=True)
    source_table = Column(String(16), nullable=False)
    cc = Column(String(2), nullable=True)
    ac = Column(String(3), nullable=True)
    country_code = Column(String(2), nullable=True)
    region_code = Column(String(3), nullable=True)
    city = Column(Text, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    latitude_text = Column(String(16), nullable=True)
    longitude_text = Column(String(16), nullable=True)
