from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field


class SectionBase(BaseModel):
    """Wiki section base schema."""

    section_name: str = Field(..., max_length=255)
    section_description: Optional[str] = None
    section_sort: int = 0
    section_active: bool = True
    wiki_active: bool = True


class SectionCreate(SectionBase):
    """Wiki section creation schema."""
    pass


class SectionUpdate(BaseModel):
    """Wiki section update schema."""

    section_name: Optional[str] = Field(None, max_length=255)
    section_description: Optional[str] = None
    section_sort: Optional[int] = None
    section_active: Optional[bool] = None
    wiki_active: Optional[bool] = None


class SectionOut(SectionBase):
    """Wiki section output schema."""

    section_id: int
    created: datetime
    updated: Optional[datetime] = None


class CategoryBase(BaseModel):
    """Wiki category base schema."""

    category_name: str = Field(..., max_length=255)
    category_description: Optional[str] = None
    category_sort: int = 0
    category_active: bool = True
    section_id: int
    parent_category_id: Optional[int] = None


class CategoryCreate(CategoryBase):
    """Wiki category creation schema."""
    pass


class CategoryUpdate(BaseModel):
    """Wiki category update schema."""

    category_name: Optional[str] = Field(None, max_length=255)
    category_description: Optional[str] = None
    category_sort: Optional[int] = None
    category_active: Optional[bool] = None
    section_id: Optional[int] = None
    parent_category_id: Optional[int] = None


class CategoryOut(CategoryBase):
    """Wiki category output schema."""

    category_id: int
    created: datetime
    updated: Optional[datetime] = None


class EntryBase(BaseModel):
    """Wiki entry base schema."""

    entry_name: str = Field(..., max_length=255)
    slug: Optional[str] = Field(None, max_length=511)
    entry_short: Optional[str] = None
    entry_content: Optional[str] = None
    generate_text: Optional[str] = None
    ispublic: bool = False
    entry_number: int = 0
    category_id: Optional[int] = None
    entry_generate: Optional[bool] = None
    entry_active: bool = True
    entry_published: Optional[date] = None


class EntryCreate(EntryBase):
    """Wiki entry creation schema."""
    pass


class EntryUpdate(BaseModel):
    """Wiki entry update schema."""

    entry_name: Optional[str] = Field(None, max_length=255)
    entry_short: Optional[str] = None
    entry_content: Optional[str] = None
    generate_text: Optional[str] = None
    ispublic: Optional[bool] = None
    entry_number: Optional[int] = None
    category_id: Optional[int] = None
    entry_generate: Optional[bool] = None
    entry_active: Optional[bool] = None
    entry_published: Optional[date] = None


class EntryOut(EntryBase):
    """Wiki entry output schema."""

    entry_id: int
    slug: Optional[str] = None
    created: datetime
    updated: Optional[datetime] = None


class RelationBase(BaseModel):
    """Wiki relation base schema."""

    entry_from_id: int
    entry_to_id: int


class RelationCreate(RelationBase):
    """Wiki relation creation schema."""
    pass


class RelationUpdate(BaseModel):
    """Wiki relation update schema."""

    entry_from_id: Optional[int] = None
    entry_to_id: Optional[int] = None


class RelationOut(RelationBase):
    """Wiki relation output schema."""

    relation_id: int
    created: datetime


class PageBase(BaseModel):
    """Wiki page base schema."""

    page_name: str = Field(..., max_length=100)


class PageCreate(PageBase):
    """Wiki page creation schema."""
    pass


class PageUpdate(BaseModel):
    """Wiki page update schema."""

    page_name: Optional[str] = Field(None, max_length=100)


class PageOut(PageBase):
    """Wiki page output schema."""

    page_id: int
    created: datetime
    updated: Optional[datetime] = None


class PageContentBase(BaseModel):
    """Wiki page content base schema."""

    page_id: int
    entry_id: int


class PageContentCreate(PageContentBase):
    """Wiki page content creation schema."""
    pass


class PageContentUpdate(BaseModel):
    """Wiki page content update schema."""

    page_id: Optional[int] = None
    entry_id: Optional[int] = None


class PageContentOut(PageContentBase):
    """Wiki page content output schema."""

    page_content_id: int
    created: datetime