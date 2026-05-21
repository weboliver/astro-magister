"""Tests for SynastryRequest Pydantic schema (RED phase — schema not yet implemented)."""
from pydantic import ValidationError
from app.schemas.datetime_models import SynastryRequest


def test_valid_dual_payload():
    """Test 1: SynastryRequest with valid dual birth data + comparison_mode='hh' passes."""
    r = SynastryRequest(
        person_a_year=1990, person_a_month=6, person_a_day=15,
        person_b_year=1992, person_b_month=3, person_b_day=22,
    )
    assert r.comparison_mode == 'hh'


def test_missing_person_a_field_fails():
    """Test 2: SynastryRequest missing person_a_year fails validation."""
    try:
        SynastryRequest(person_b_year=1990, person_b_month=1, person_b_day=1)
        assert False, 'Should have raised ValidationError'
    except ValidationError:
        pass


def test_invalid_comparison_mode_fails():
    """Test 3: SynastryRequest with comparison_mode='invalid' fails validation."""
    try:
        SynastryRequest(
            person_a_year=1990, person_a_month=1, person_a_day=1,
            person_b_year=1990, person_b_month=1, person_b_day=1,
            comparison_mode='invalid',
        )
        assert False, 'Should have raised ValidationError'
    except ValidationError:
        pass


def test_explicit_rr_mode_works():
    """Test 4: SynastryRequest with explicit comparison_mode='rr' works."""
    r = SynastryRequest(
        person_a_year=1990, person_a_month=1, person_a_day=1,
        person_b_year=1990, person_b_month=1, person_b_day=1,
        comparison_mode='rr',
    )
    assert r.comparison_mode == 'rr'
