from subsample_balanced import subsample


def test_subsample_caps_per_language():
    rows = [{"language": "en"}] * 5 + [{"language": "vi"}] * 2
    out = list(subsample(rows, per_lang=3, languages={"en", "vi"}))
    langs = [r["language"] for r in out]
    assert langs.count("en") == 3
    assert langs.count("vi") == 2


def test_subsample_skips_unwanted_language():
    rows = [{"language": "de"}, {"language": "en"}]
    out = list(subsample(rows, per_lang=10, languages={"en"}))
    assert [r["language"] for r in out] == ["en"]


def test_subsample_empty_languages_keeps_all_up_to_cap():
    rows = [{"language": "en"}] * 2 + [{"language": "de"}] * 2
    out = list(subsample(rows, per_lang=1, languages=set()))
    assert sorted(r["language"] for r in out) == ["de", "en"]
