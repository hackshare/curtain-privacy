# Leak Findings

Source: `baseline/leaks.json` (shipped model + DL/CC heuristic recognizers + `extendSpans` fiscal-ID
span extension + monotonic span merge + Unicode-complete EMAIL/URL heuristics, no `reconcileAddress`,
frozen 30k Latin slice). Metric: **char-level / occurrence-anchored** — each significant character in
a gold occurrence is scored as protected or not; a term occurrence is fully protected only if every
significant character falls under a redaction span. The three causes are **undetected** (no detection
overlap at all), **keep_misroute** (detected but routed to the keep set by policy), and **under_cover**
(detected and redacted but the span doesn't fully cover all significant chars of the gold term). These
numbers are char-level and are not comparable to the earlier position-based recall figures.

## Aggregate

- Char-recall (private, summary.json): **99.22 %** (private_total 129 258 occurrences across 30 000 rows).
- Protected-rate: **98.89 %** Wilson-95 CI **[98.83 %, 98.94 %]** — the fraction of private
  occurrences fully protected (char_recall ≥ 1.0 for that occurrence).
- Public char-retention: **96.81 %** (fraction of significant public chars not covered by any
  redaction span; lower means more over-redaction).
- Char-level cause totals (leaks.json): undetected 770, keep_misroute 69, under_cover 599.

## Per-label table (sorted by char_recall ascending)

| label | char_recall | protected_rate | CI-95 | private_total | undetected | keep_misroute | under_cover |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CREDIT_CARD | 0.9540 | 0.9543 | [0.9490, 0.9590] | 6 646 | 294 | 0 | 10 |
| SSN | 0.9629 | 0.9445 | [0.9379, 0.9504] | 5 153 | 76 | 5 | 205 |
| BUILDING_NUMBER | 0.9795 | 0.9761 | [0.9729, 0.9789] | 9 942 | 168 | 17 | 53 |
| GIVEN_NAME | 0.9944 | 0.9901 | [0.9888, 0.9912] | 25 337 | 156 | 20 | 75 |
| STREET_NAME | 0.9946 | 0.9863 | [0.9838, 0.9884] | 10 132 | 27 | 17 | 95 |
| SURNAME | 0.9975 | 0.9946 | [0.9936, 0.9955] | 21 958 | 39 | 9 | 70 |
| EMAIL | 0.9990 | 0.9967 | [0.9957, 0.9975] | 15 716 | 0 | 0 | 52 |
| TAX_ID | 0.9990 | 0.9989 | [0.9976, 0.9995] | 5 521 | 5 | 0 | 1 |
| PHONE | 0.9995 | 0.9967 | [0.9955, 0.9976] | 11 638 | 0 | 0 | 38 |
| GOVERNMENT_ID | 0.9995 | 0.9996 | [0.9987, 0.9999] | 6 926 | 3 | 0 | 0 |
| DRIVERS_LICENSE | 0.9997 | 0.9995 | [0.9985, 0.9998] | 6 037 | 2 | 1 | 0 |
| PASSPORT | 1.0000 | 1.0000 | [0.9991, 1.0000] | 4 252 | 0 | 0 | 0 |

## Coverage monotonicity

Two Pareto fixes landed on top of the prior freeze and are the reason this baseline is being
re-frozen. Both close `under_cover` leaks — spans that were detected and redacted but whose byte
boundaries left significant characters of the gold term exposed — without shifting the operating
point or over-redacting public text.

**A. Monotonic span merge (`mergeSpans`).** On any overlap the merged span now covers the byte-union
under a default-deny label (a redact-class span always beats an overlapping keep-class one), so a
merge can never re-expose bytes a detector already redacted. The prior merge kept only the "winner"
on partial overlap, silently dropping the loser's exclusive range. This restores the coverage
invariant *the union of detected redact spans is monotonic under merge* and directly removes the
fiscal-ID boundary leaks that survived `extendSpans`:

| label | under_cover before | under_cover after |
| --- | --- | --- |
| SSN | 317 | 205 |
| CREDIT_CARD | 33 | 10 |

**B. Unicode-complete EMAIL/URL heuristics.** The EMAIL/URL regexes now match `\p{L}`/`\p{N}` under
the `u` flag, so accented local parts and hostnames (e.g. `mémoichon@…`, `www.café.fr`) are captured
whole and premasked behind a sentinel before the model sees them. Previously the ASCII-only class
clipped the address at the first non-ASCII byte, leaving the tail exposed:

| label | under_cover before | under_cover after |
| --- | --- | --- |
| EMAIL | 245 | 52 |

**Aggregate effect (frozen 30k slice, vs the prior frozen baseline at HEAD):**

- Char-recall: 99.11 % → **99.22 %** (+0.1085 pp).
- Protected-rate: 98.63 % → **98.89 %** (+0.2615 pp).
- Public char-retention: 96.8213 % → 96.8141 %, a drop of **0.0073 pp** — well within the 0.2 pp
  over-redaction gate.
- Total under_cover cause hits: 929 → 598; total leaked-occurrence cause hits 1 776 → 1 438.

## Fiscal-ID span extension

The `extendSpans` pass (EXTEND_LABELS covers all eight structured-ID labels; TAX_ID, SSN, and
CREDIT_CARD dominate the under_cover reduction, and GOVERNMENT_ID, DRIVERS_LICENSE, and PASSPORT are
cleared as direct effects too; growing detected spans across adjacent connector characters and
trimming trailing punctuation, never shrinking) targets the under_cover leaks that dominated
fiscal-ID exposure — formatted national fiscal codes where the model emitted a span but its
boundaries left significant characters exposed. With the monotonic merge now also active (section A),
TAX_ID under_cover reaches 1, SSN 205, and CREDIT_CARD 10 on this freeze.

TAX_ID sits near the top of the table (0.9990 char_recall); DRIVERS_LICENSE, GOVERNMENT_ID, and
PASSPORT are effectively clean. The extension buys a large privacy gain at negligible retention cost
because it only grows spans that already overlap a detected fiscal ID and stops at whitespace.

## Per-language notes

**By language** (char_recall / protected_rate / public_char_retention):

| lang | char_recall | protected_rate | public_char_retention |
| --- | --- | --- | --- |
| de | 99.44 % | 98.98 % | 97.01 % |
| en | 99.18 % | 99.10 % | 96.05 % |
| es | 99.38 % | 99.19 % | 96.89 % |
| fr | 99.43 % | 98.63 % | 97.10 % |
| it | 98.63 % | 98.23 % | 97.49 % |
| nl | 98.56 % | 98.46 % | 97.18 % |
| pt | 99.67 % | 99.48 % | 97.49 % |

**nl** is now the lowest per-language char_recall at 98.56 %, with **it** just above at 98.63 %; **it**
is the lowest per-language protected_rate at 98.23 %, driven by residual SSN under_cover and
CREDIT_CARD/BUILDING_NUMBER undetected cases. Public char-retention per language is unchanged from the
prior freeze — the coverage-monotonicity fixes do not over-redact public text.

**CREDIT_CARD** is now the lowest-char_recall label at 95.40 %. Its 294 undetected cases reflect
card-number format variants (non-standard lengths or separators) that escape the Luhn/length
heuristic; the monotonic merge cut its under_cover from 33 to 10 but cannot recover cards the
heuristic never detected.

**SSN** char_recall is 96.29 %. Its remaining 205 under_cover cases are non-US separator/grouping
variants the connector set does not span, plus 76 undetected; the monotonic merge cut SSN under_cover
from 317 but did not eliminate it.

**BUILDING_NUMBER** reaches 97.95 % char_recall with 168 undetected and 53 under_cover. The
undetected path dominates — bare numeric street numbers with no adjacent STREET_NAME span are
invisible to the model.

**EMAIL** reaches 99.90 % char_recall with 0 undetected and 52 under_cover — down from 245 under_cover
now that the Unicode-complete heuristic captures accented addresses whole (section B).

**DRIVERS_LICENSE** is strong across all languages: 99.97 % char_recall, 0 under_cover, 1
keep_misroute case remaining. The DL heuristic recognizer is retained.

## Where the leaks concentrate

Under_cover is the single largest cause by occurrence count — 598 of 1 438 total leaked-occurrence
cause hits (41.6 %) — but it is down from 929 at the prior freeze now that the monotonic merge and the
Unicode EMAIL/URL fix have removed the SSN/CC boundary leaks and the accented-email leaks. The
residual concentration is SSN (205), STREET_NAME (95), GIVEN_NAME (75), SURNAME (70), BUILDING_NUMBER
(53), and EMAIL (52).

The actionable undetected path has 771 hits, led by CREDIT_CARD (294), BUILDING_NUMBER (168), and
GIVEN_NAME (156). Keep_misroute is 69 total — low — with GIVEN_NAME (20), STREET_NAME (17), and
BUILDING_NUMBER (17) as the main clusters.

## Operating-point knob

The pipeline exposes a `--operating-point` flag (`aggressive` / `balanced` / `conservative`) that
scales NER thresholds uniformly. `balanced` (threshold anchor = 0.4) is the shipped default and is the
frozen baseline in this document; the values above are all measured at `balanced`. The knob provides a
recall/retention dial across the conservative→aggressive axis: aggressive raises char_recall by a few
hundredths of a pp and costs a comparable sliver of retention vs balanced; conservative drops
char_recall by ≈ 1.8 pp and recovers ≈ 0.1 pp of retention. The dominant effect is on recall —
retention variation is negligible (≈ 0.10 pp total) across the full knob range.

## Metric change + recognizer decisions

**Metric change.** The leak metric is char-level and occurrence-anchored (significant chars protected
per occurrence, not substring presence or gold-span position coverage). `char_recall` is the weighted
fraction of significant private characters that are covered by any redaction span; `protected_rate`
(Wilson-95 CI reported) is the fraction of private occurrences fully protected. These numbers are
**not comparable** to the earlier substring-recall or position-based recall figures in prior
LEAK-FINDINGS versions.

**Monotonic span merge — added.** `mergeSpans` now takes the byte-union under a default-deny label on
any overlap (section A). SSN under_cover 317 → 205, CREDIT_CARD 33 → 10; no retention regression.

**Unicode-complete EMAIL/URL heuristics — added.** EMAIL/URL regexes match `\p{L}`/`\p{N}` under the
`u` flag so accented addresses premask whole (section B). EMAIL under_cover 245 → 52; 0 undetected.

**Fiscal-ID span extension (`extendSpans`) — kept.** Grows detected fiscal-ID spans across connector
characters and trims trailing punctuation, never shrinking; wired into both the runtime guard and the
bench harness before policy, applied to the merged `[...heuristic, ...modelSpans]` set.

**reconcileAddress — removed.** BUILDING_NUMBER char_recall did not clear the ≥ 1.0 pp keep bar under
the char-level metric; the recognizer was deleted and the harness/guard use the merged
`[...heuristic, ...modelSpans]` set (now passed through `extendSpans` and the monotonic merge).

**PHONE recognizer — added.** A conservative NANP recognizer (formatted 10-digit, area/exchange first
digit `[2-9]`, required separator) in `src/heuristics.ts`. Its measured effect on the frozen 30k is
negligible — the model already catches phones (PHONE undetected 1 → 0, char_recall 0.9994 → 0.9995,
protected_rate and retention unchanged); the value is deterministic ownership + a backstop for phones
the model misses (the reason it was added: a from-scratch model missed real-world US phones). Because
the regex matches only the NANP *core* of a longer international/extension number, PHONE is **not**
premasked (unlike SSN/CC/IP/EMAIL/URL) — premasking a partial match blinds the model to the remainder;
it is instead an additive redaction span merged with the model's view. Excluded from premask via
`NO_PREMASK_LABELS` in `src/premask.ts`.

**DRIVERS_LICENSE recognizer — kept.** Char_recall 99.97 %, keep_misroute 1. The DL heuristic pattern
is retained in `src/heuristics.ts`.

**CREDIT_CARD length extension — kept.** Contributes to CREDIT_CARD heuristic coverage; removing it
would raise undetected counts further.

**Retention gate.** Public char-retention is 96.8141 % with both coverage-monotonicity fixes on vs
96.8213 % before them — a drop of 0.0073 pp, well within the 0.2 pp gate. No retention concern.
