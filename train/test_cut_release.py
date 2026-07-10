import pytest
from cut_release import build_tag


def test_build_tag_composes_version_and_timestamp():
    assert build_tag("1.0.0", "20260709224500") == "v1.0.0-20260709224500"


def test_build_tag_rejects_empty_timestamp():
    with pytest.raises(ValueError):
        build_tag("1.0.0", "")
