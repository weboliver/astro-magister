"""Tests for draw_chart_png second_chart parameter extension (RED phase — not yet implemented)."""
import inspect
from app.services.horoscope_graphics import draw_chart_png


def test_second_chart_parameter_exists():
    """Test 1: draw_chart_png() signature includes second_chart parameter."""
    sig = inspect.signature(draw_chart_png)
    params = list(sig.parameters.keys())
    assert 'second_chart' in params, f'second_chart not in parameters: {params}'


def test_second_chart_default_none():
    """Test 2: second_chart parameter defaults to None."""
    sig = inspect.signature(draw_chart_png)
    assert sig.parameters['second_chart'].default is None, \
        'second_chart default must be None'


def test_transit_chart_unchanged():
    """Test 3: transit_chart parameter still exists and defaults to None."""
    sig = inspect.signature(draw_chart_png)
    params = list(sig.parameters.keys())
    assert 'transit_chart' in params, 'transit_chart parameter must remain'
    assert sig.parameters['transit_chart'].default is None, \
        'transit_chart default must be None'


def test_chart_parameter_unchanged():
    """Test 4: chart parameter still exists as first positional after app."""
    sig = inspect.signature(draw_chart_png)
    params = list(sig.parameters.keys())
    assert params[1] == 'chart', f'chart must be second parameter, got: {params[1]}'


def test_parameter_order():
    """Test 5: second_chart is the last parameter (after transit_chart)."""
    sig = inspect.signature(draw_chart_png)
    params = list(sig.parameters.keys())
    transit_idx = params.index('transit_chart')
    second_idx = params.index('second_chart')
    assert second_idx == transit_idx + 1, \
        f'second_chart must come after transit_chart. transit at {transit_idx}, second at {second_idx}'
