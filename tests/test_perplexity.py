import asyncio
import json

import pytest

from app.services.perplexity import PerplexityClient, _strip_think_blocks, _ThinkStreamFilter


def test_strip_think_blocks_removes_hidden_reasoning():
    text = "Einleitung<think>interne Analyse</think>Antwort"

    assert _strip_think_blocks(text) == "EinleitungAntwort"


def test_strip_think_blocks_removes_unclosed_think_tail():
    text = "Sichtbar<think>nicht sichtbar"

    assert _strip_think_blocks(text) == "Sichtbar"


def test_think_stream_filter_hides_chunks_across_boundaries():
    stream_filter = _ThinkStreamFilter()
    chunks = [
        "Hallo ",
        "<thi",
        "nk>interne ",
        "Analyse</th",
        "ink>Welt",
        "!",
    ]

    visible = "".join(stream_filter.process(chunk) for chunk in chunks)
    visible += stream_filter.flush()

    assert visible == "Hallo Welt!"


@pytest.mark.parametrize(
    ('chunks', 'expected'),
    [
        (["A", "B", "C"], "ABC"),
        (["Start<think>x</think>Ende"], "StartEnde"),
    ],
)
def test_think_stream_filter_preserves_visible_content(chunks, expected):
    stream_filter = _ThinkStreamFilter()

    visible = "".join(stream_filter.process(chunk) for chunk in chunks)
    visible += stream_filter.flush()

    assert visible == expected


def test_send_summary_stream_falls_back_when_stream_echoes_prompt(monkeypatch):
    summary = "Huber Astrologische Psychologie. Erstelle eine Interpretation für folgende Alterspunkte im Jahr 2026."

    class _FakeResponse:
        def raise_for_status(self):
            return None

        async def aiter_lines(self):
            payload = json.dumps({"choices": [{"delta": {"content": summary}}]})
            yield f"data: {payload}"
            yield "data: [DONE]"

    class _FakeStreamContext:
        async def __aenter__(self):
            return _FakeResponse()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, *args, **kwargs):
            return _FakeStreamContext()

    monkeypatch.setattr('app.services.perplexity.httpx.AsyncClient', _FakeAsyncClient)

    client = PerplexityClient(api_key='test-key')
    monkeypatch.setattr(
        client,
        'send_summary_text',
        lambda summary, system_prompt=None, use_cache=True, retry_on_prompt_echo=True: 'Interpretation statt Prompt-Echo',
    )

    async def _collect():
        chunks = []
        async for chunk in client.send_summary_stream(summary=summary, system_prompt='age_points'):
            chunks.append(chunk)
        return chunks

    assert asyncio.run(_collect()) == ['Interpretation statt Prompt-Echo']