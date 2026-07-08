from fairness.generate import generate_cases

def test_cases_are_resolvable_and_labeled_ours():
    cases = generate_cases(seed=100, n=40)
    assert len(cases) == 40
    for c in cases:
        assert c["tier"] in ("normal", "messy")
        for t in c["redact"]:
            assert t["value"] in c["text"]                 # loadCases resolves by indexOf
            assert t["label"] in ("GIVEN_NAME", "SURNAME", "GOVERNMENT_ID")
        for k in c["keep"]:
            assert k["value"] in c["text"]

def test_disjoint_seed_differs_from_training_seed_names():
    # Fairness seed 100 must not reproduce the same names as an augmentation-style seed 1.
    from faker import Faker
    fa = Faker(["es_ES", "fr_FR", "de_DE"]); fa.seed_instance(1)
    train_names = {fa.first_name() for _ in range(50)}
    eval_names = {t["value"] for c in generate_cases(seed=100, n=40)
                  for t in c["redact"] if t["label"] == "GIVEN_NAME"}
    assert len(eval_names - train_names) > 0                # eval has names not in the train sample
