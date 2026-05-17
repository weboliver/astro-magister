from __future__ import annotations

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.orm import relationship

from app.db.session import Base


class Section(Base):
    __tablename__ = 'sections'

    section_id = Column(Integer, primary_key=True, autoincrement=True)
    section_name = Column(String(255), unique=True, nullable=False)
    section_description = Column(Text)
    section_sort = Column(Integer, nullable=False, default=0, server_default=text('0'))
    section_active = Column(Boolean, nullable=False, default=True, server_default=text('true'))
    wiki_active = Column(Boolean, nullable=False, default=True, server_default=text('true'))
    created = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated = Column(DateTime(timezone=True), onupdate=func.now())

    categories = relationship('Category', back_populates='section')


class Category(Base):
    __tablename__ = 'categories'

    category_id = Column(Integer, primary_key=True, autoincrement=True)
    category_name = Column(String(255), nullable=False)
    category_description = Column(Text)
    category_sort = Column(Integer, nullable=False, default=0, server_default=text('0'))
    category_active = Column(Boolean, nullable=False, default=True, server_default=text('true'))
    section_id = Column(Integer, ForeignKey('sections.section_id'), nullable=False)
    parent_category_id = Column(Integer, ForeignKey('categories.category_id'))
    created = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated = Column(DateTime(timezone=True), onupdate=func.now())

    section = relationship('Section', back_populates='categories')
    parent_category = relationship('Category', remote_side=[category_id], back_populates='child_categories')
    child_categories = relationship('Category', back_populates='parent_category')
    entries = relationship('Entry', back_populates='category')


class Entry(Base):
    __tablename__ = 'entries'

    entry_id = Column(Integer, primary_key=True, autoincrement=True)
    entry_name = Column(String(255), nullable=False)
    slug = Column(String(511), nullable=False, unique=True)
    entry_short = Column(Text)
    entry_content = Column(Text)
    generate_text = Column(Text)
    ispublic = Column(Boolean, nullable=False, default=False, server_default=text('false'))
    entry_number = Column(Integer, nullable=False, default=0, server_default=text('0'))
    category_id = Column(Integer, ForeignKey('categories.category_id'))
    entry_generate = Column(Boolean)
    entry_active = Column(Boolean, nullable=False, default=True, server_default=text('true'))
    entry_published = Column(Date)
    created = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated = Column(DateTime(timezone=True), onupdate=func.now())

    def regenerate_slug(self):
        import re
        base = re.sub(r'[^a-z0-9]+', '-', self.entry_name.lower()).strip('-')
        self.slug = f"{base}-{self.entry_id}"

    category = relationship('Category', back_populates='entries')
    outgoing_relations = relationship('Relation', foreign_keys='Relation.entry_from_id', back_populates='entry_from')
    incoming_relations = relationship('Relation', foreign_keys='Relation.entry_to_id', back_populates='entry_to')
    page_contents = relationship('PageContent', back_populates='entry')


class Relation(Base):
    __tablename__ = 'relations'

    relation_id = Column(Integer, primary_key=True, autoincrement=True)
    entry_from_id = Column(Integer, ForeignKey('entries.entry_id'), nullable=False)
    entry_to_id = Column(Integer, ForeignKey('entries.entry_id'), nullable=False)
    created = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    entry_from = relationship('Entry', foreign_keys=[entry_from_id], back_populates='outgoing_relations')
    entry_to = relationship('Entry', foreign_keys=[entry_to_id], back_populates='incoming_relations')


class Page(Base):
    __tablename__ = 'pages'

    page_id = Column(Integer, primary_key=True, autoincrement=True)
    page_name = Column(String(100), unique=True, nullable=False)
    created = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated = Column(DateTime(timezone=True), onupdate=func.now())

    page_contents = relationship('PageContent', back_populates='page')


class PageContent(Base):
    __tablename__ = 'page_content'

    page_content_id = Column(Integer, primary_key=True, autoincrement=True)
    page_id = Column(Integer, ForeignKey('pages.page_id'), nullable=False)
    entry_id = Column(Integer, ForeignKey('entries.entry_id'), nullable=False)
    created = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    page = relationship('Page', back_populates='page_contents')
    entry = relationship('Entry', back_populates='page_contents')