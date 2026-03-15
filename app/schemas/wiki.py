from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field


class SectionBase(BaseModel):
    section_name: str = Field(..., max_length=255)
    section_description: Optional[str] = None
    section_sort: int = 0
    section_active: bool = True
    wiki_active: bool = True


class SectionCreate(SectionBase):
    pass


class SectionUpdate(BaseModel):
    section_name: Optional[str] = Field(None, max_length=255)
    section_description: Optional[str] = None
    section_sort: Optional[int] = None
    section_active: Optional[bool] = None
    wiki_active: Optional[bool] = None


class SectionOut(SectionBase):
    section_id: int
    created: datetime
    updated: Optional[datetime] = None


class CategoryBase(BaseModel):
    category_name: str = Field(..., max_length=255)
    category_description: Optional[str] = None
    category_sort: int = 0
    category_active: bool = True
    section_id: int
    parent_category_id: Optional[int] = None


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    category_name: Optional[str] = Field(None, max_length=255)
    category_description: Optional[str] = None
    category_sort: Optional[int] = None
    category_active: Optional[bool] = None
    section_id: Optional[int] = None
    parent_category_id: Optional[int] = None


class CategoryOut(CategoryBase):
    category_id: int
    created: datetime
    updated: Optional[datetime] = None


class EntryBase(BaseModel):
    entry_name: str = Field(..., max_length=255)
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
    pass


class EntryUpdate(BaseModel):
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
    entry_id: int
    created: datetime
    updated: Optional[datetime] = None


class RelationBase(BaseModel):
    entry_from_id: int
    entry_to_id: int


class RelationCreate(RelationBase):
    pass


class RelationUpdate(BaseModel):
    entry_from_id: Optional[int] = None
    entry_to_id: Optional[int] = None


class RelationOut(RelationBase):
    relation_id: int
    created: datetime


class PageBase(BaseModel):
    page_name: str = Field(..., max_length=100)


class PageCreate(PageBase):
    pass


class PageUpdate(BaseModel):
    page_name: Optional[str] = Field(None, max_length=100)


class PageOut(PageBase):
    page_id: int
    created: datetime
    updated: Optional[datetime] = None


class PageContentBase(BaseModel):
    page_id: int
    entry_id: int


class PageContentCreate(PageContentBase):
    pass


class PageContentUpdate(BaseModel):
    page_id: Optional[int] = None
    entry_id: Optional[int] = None


class PageContentOut(PageContentBase):
    page_content_id: int
    created: datetime