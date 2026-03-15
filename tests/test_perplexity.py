import pytest

from app.services.perplexity import _strip_think_blocks, _ThinkStreamFilter


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