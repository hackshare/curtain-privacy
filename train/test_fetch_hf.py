from fetch_hf import LATIN, keep_row, floors_met

LANGS = {"en", "vi", "tl"}


def test_latin_has_24_languages():
    assert LATIN == {
        "en", "es", "fr", "de", "it", "pt", "nl",
        "pl", "cs", "sk", "lt", "lv", "et", "sv", "da", "fi",
        "hu", "ro", "sl", "hr", "vi", "ms", "id", "tl",
    }


def test_keep_row_rejects_unwanted_language():
    assert keep_row("de", {}, LANGS, 10) is False  # de not in LANGS here


def test_keep_row_respects_cap():
    assert keep_row("en", {"en": 9}, LANGS, 10) is True
    assert keep_row("en", {"en": 10}, LANGS, 10) is False


def test_keep_row_zero_cap_is_unbounded():
    assert keep_row("en", {"en": 10_000}, LANGS, 0) is True


def test_floors_met_requires_every_language():
    assert floors_met({"en": 5, "vi": 5, "tl": 5}, LANGS, 5) is True
    assert floors_met({"en": 5, "vi": 5, "tl": 4}, LANGS, 5) is False


def test_floors_met_zero_floor_never_triggers():
    assert floors_met({"en": 100}, LANGS, 0) is False
