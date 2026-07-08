ENTITY_TYPES = [
    "GIVEN_NAME", "SURNAME", "EMAIL", "PHONE", "URL", "TAX_ID", "BANK_ACCOUNT",
    "ROUTING_NUMBER", "GOVERNMENT_ID", "PASSPORT", "DRIVERS_LICENSE",
    "BUILDING_NUMBER", "STREET_NAME", "SECONDARY_ADDRESS", "CITY", "STATE", "ZIP_CODE",
]
LABELS = ["O"] + [f"{p}-{t}" for t in ENTITY_TYPES for p in ("B", "I")]  # 35
LABEL2ID = {l: i for i, l in enumerate(LABELS)}
ID2LABEL = {i: l for l, i in LABEL2ID.items()}
