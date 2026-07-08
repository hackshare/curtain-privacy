# Real-World Eval Results

Cases: 157. Metric: char-level occurrence-anchored (same as the OpenPII bench).

## Headline

- protected_rate (overall): **99.76%** (416/417)
- keep_violation_rate (overall): **1.46%** (3/205)
- normal: protected 100.00% (275/275), keep-violation 0.82% (1/122)
- messy: protected 99.30% (141/142), keep-violation 2.41% (2/83)

## By label (protected_rate)

| label | protected | total | rate |
| --- | --- | --- | --- |
| GIVEN_NAME | 71 | 72 | 98.61% |
| CREDIT_CARD | 21 | 21 | 100.00% |
| EMAIL | 45 | 45 | 100.00% |
| BUILDING_NUMBER | 19 | 19 | 100.00% |
| STREET_NAME | 19 | 19 | 100.00% |
| PHONE | 25 | 25 | 100.00% |
| SURNAME | 72 | 72 | 100.00% |
| SSN | 24 | 24 | 100.00% |
| PASSPORT | 13 | 13 | 100.00% |
| DRIVERS_LICENSE | 16 | 16 | 100.00% |
| BANK_ACCOUNT | 16 | 16 | 100.00% |
| ROUTING_NUMBER | 16 | 16 | 100.00% |
| IP_ADDRESS | 18 | 18 | 100.00% |
| URL | 17 | 17 | 100.00% |
| TAX_ID | 12 | 12 | 100.00% |
| GOVERNMENT_ID | 12 | 12 | 100.00% |

## Leaks (redact terms not fully protected)

- `cc-update-01` GIVEN_NAME: "Gina"

## Keep violations (landmines that got redacted)

- `dl-gov-combo-01`: "Florida"
- `ssn-name-02`: "#CAL-2290"
- `ip-abuse-01`: "#INC-0077"
