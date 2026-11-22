"""
Render-on-miss endpoint for article cover files.

nginx serves ``/static/wiki-covers/<hash>.webp`` straight from the shared /workspace
mount and falls back to this router only when the file is missing (D-05). An unknown
hash answers 404 without rendering and without touching the database: the file name is
a hash over the inputs, so the only way to know which glyph and presets it stands for
is the in-memory index over the whitelist (23 glyphs x 50 allowed colour pairs = 1 150
entries). That is also what bounds what can ever be rendered — at most those 1 150
files, roughly 9 MB — so a guessed URL costs one lookup instead of CPU time and disk.

No ``Cache-Control`` header is set here on purpose: nginx adds exactly one, and a
second header on the same response is the defect the ``/_astro`` location already
carries. The file is only rendered when the whitelist knows the hash, which is why the
missing-file path stays cheap (D-08, J-2).
"""
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.services import wiki_covers


router = APIRouter(tags=['wiki-covers'])

_FILENAME = re.compile(r'^[0-9a-f]{32}\.webp$')


@router.get('/static/wiki-covers/{filename}')
def get_cover(filename: str):
    """Serve a cover file, rendering it from the whitelist when the file is missing.

    Args:
        filename: ``<32 hex>.webp`` exactly as ``wiki_covers.cover_url`` produces it.

    Returns:
        The WebP bytes with ``image/webp``.

    Raises:
        HTTPException: 404 for a malformed name or a hash outside the whitelist. A file
            that is missing (or empty) but whitelisted is rendered again, never a 500.
    """
    if not _FILENAME.fullmatch(filename):
        raise HTTPException(status_code=404, detail='Cover not found')

    # The path is rebuilt from the validated match — the raw parameter never reaches
    # the filesystem, so "../" and friends cannot become a path (T-39-01).
    stem = filename[:-len('.webp')]
    path = wiki_covers.cover_dir() / f'{stem}.webp'
    # Read first, check afterwards: an ``is_file()`` probe followed by ``read_bytes()`` races
    # a file that disappears in between (deploy, manual cleanup) into a 500. A missing or
    # empty file takes the render-on-miss path below instead.
    try:
        data = path.read_bytes()
    except (FileNotFoundError, IsADirectoryError, NotADirectoryError):
        data = b''
    if data:
        return Response(content=data, media_type='image/webp')

    params = wiki_covers.params_for_hash(stem)
    if params is None:
        # Unknown hash: 404 without rendering, without a file and without a DB read.
        raise HTTPException(status_code=404, detail='Cover not found')

    regenerated = wiki_covers.ensure_cover(*params)
    return Response(content=regenerated.read_bytes(), media_type='image/webp')
