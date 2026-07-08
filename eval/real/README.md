# Real-World Eval Corpus

Hand-authored en-US chat messages for evaluating on-device PII redaction. Each case is a realistic user turn to an AI assistant (support requests, form fills, scheduling, disputes) with ground-truth redaction and keep annotations.

## Values policy

All PII values are **fake, format-valid, and safe**:

- **Credit cards**: network test PANs only — `4111 1111 1111 1111` (Visa), `5500 0000 0000 0004` (Mastercard), `3400 0000 0000 009` (Amex), `6011 0000 0000 0004` (Discover). All Luhn-valid.
- **Phones**: full 10-digit NANP forms with the reserved fictional `555-0100`–`555-0199` suffix (e.g. `(212) 555-0112`, `415-555-0177`, `(800) 555-0132`). The `555-01xx` suffix is reserved for fictional use in any area code.
- **SSNs**: format-valid values only. Area not 000, 666, or 900–999; group ≠ 00; serial ≠ 0000. Examples: `234-56-7890`, `321-54-9876`.
- **Emails**: invented local parts at real domains (`jsmith88@gmail.com`, `t.rogers@outlook.com`).
- **Names / streets / IDs / routing numbers**: invented combinations. No real person's data. ABA routing numbers satisfy the mod-10 checksum.
- **No real person's data** appears anywhere in the corpus.

## Schema

Each line in `cases.jsonl` is a JSON object:

```
{
  "id": string,                        // kebab-case unique identifier
  "tier": "normal" | "messy",         // see Tiers below
  "text": string,                      // the message to redact
  "redact": [                          // every PII span that must be redacted
    {
      "label": PiiLabel,               // one of the 16 redact-class labels below
      "value": string,                 // verbatim substring of text
      "occurrence"?: number            // 0-based; omit if value appears exactly once
    }
  ],
  "keep": [                            // planted landmines that must NOT be redacted
    {
      "value": string,                 // verbatim substring of text
      "occurrence"?: number
    }
  ]
}
```

### Redact-class labels

`GIVEN_NAME`, `SURNAME`, `EMAIL`, `PHONE`, `SSN`, `CREDIT_CARD`, `STREET_NAME`, `BUILDING_NUMBER`, `TAX_ID`, `BANK_ACCOUNT`, `ROUTING_NUMBER`, `PASSPORT`, `DRIVERS_LICENSE`, `GOVERNMENT_ID`, `IP_ADDRESS`, `URL`

`CITY`, `STATE`, and `ZIP_CODE` are **never** in `redact` — they are keep-set by policy.

### Keep landmine categories

Three categories of values that a redactor must leave intact:

| Category | Examples |
|---|---|
| (a) Geography | `Chicago`, `IL`, `60601` |
| (b) Numbers mimicking PII | `$240`, `#ORD-8821045`, `04/12/2026`, `WIRE-20260502` |
| (c) Words mimicking names | `April`, `March`, `Apple`, `Madison` (as city) |

## Tiers

- **normal** — clean, well-formatted messages. PII appears in conventional positions (after labels, in structured fields).
- **messy** — real-but-awkward formatting: values buried in dense prose, non-standard label separators (`id:`, `ssn:`), mixed-case labels, values run together without spaces, or informal shorthand.

## Coverage requirements

The corpus satisfies:

- 150–250 total cases
- Each tier ≥ 30% of the corpus
- Each redact-class ≥ 8 occurrences across all cases
- ≥ 20 keep landmines total, ≥ 5 in category (b) (numeric)

## Running

```
bun eval/real/run.ts
```

The smoke gate (structural only, no model needed):

```
bun run test eval/real/cases.smoke.test.ts
```

## Interpreting the results

`RESULTS.md` reports two sides: `protected_rate` (redact-class PII fully hidden) and
`keep_violation_rate` (planted landmines wrongly redacted). Two caveats when reading per-label rates:

- **`GOVERNMENT_ID` is a fuzzy, open-ended class.** The corpus uses invented formats
  (`EMP-334455`, `AGN-776655`), and the guard has no heuristic backstop for them, so recognition is
  purely contextual. A low `GOVERNMENT_ID` rate reflects the genuine open-endedness of the class in
  the wild, not a clean recall figure — treat it as a floor.
- **The guard has no dedicated phone recognizer.** `PHONE` protection is entirely model-contextual.
  Realistic 10-digit phones are protected well; extremely terse or non-standard phone strings may not
  be. This is a real property of the guard worth watching, not a corpus artifact.

The headline is a first baseline on ~150 hand-authored cases (wide per-label CIs); read per-label
counts alongside rates and treat the numbers as directional.
