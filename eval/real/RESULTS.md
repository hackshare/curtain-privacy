# Real-World Eval Results

Cases: 157. Metric: char-level occurrence-anchored (same as the OpenPII bench).

## Headline

- protected_rate (overall): **99.28%** (414/417)
- keep_violation_rate (overall): **1.46%** (3/205)
- normal: protected 99.27% (273/275), keep-violation 0.00% (0/122)
- messy: protected 99.30% (141/142), keep-violation 3.61% (3/83)

## By label (protected_rate)

| label | protected | total | rate |
| --- | --- | --- | --- |
| BUILDING_NUMBER | 17 | 19 | 89.47% |
| ROUTING_NUMBER | 15 | 16 | 93.75% |
| CREDIT_CARD | 21 | 21 | 100.00% |
| EMAIL | 45 | 45 | 100.00% |
| STREET_NAME | 19 | 19 | 100.00% |
| PHONE | 25 | 25 | 100.00% |
| GIVEN_NAME | 72 | 72 | 100.00% |
| SURNAME | 72 | 72 | 100.00% |
| SSN | 24 | 24 | 100.00% |
| PASSPORT | 13 | 13 | 100.00% |
| DRIVERS_LICENSE | 16 | 16 | 100.00% |
| BANK_ACCOUNT | 16 | 16 | 100.00% |
| IP_ADDRESS | 18 | 18 | 100.00% |
| URL | 17 | 17 | 100.00% |
| TAX_ID | 12 | 12 | 100.00% |
| GOVERNMENT_ID | 12 | 12 | 100.00% |

## Leaks (redact terms not fully protected)

- `direct-deposit-01` ROUTING_NUMBER: "111000025"
- `pickup-request-01` BUILDING_NUMBER: "789"
- `street-messy-01` BUILDING_NUMBER: "675"

## Keep violations (landmines that got redacted)

- `bank-messy-01`: "WIRE-20260502"
- `bank-transfer-03`: "#VEND-2210"
- `dl-traffic-01`: "CO"
