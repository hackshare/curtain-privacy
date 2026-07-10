import type { Span } from "curtain-privacy";

export interface MappingRow {
  placeholder: string;
  label: string;
  value: string;
}

/** Pair each detected value with the placeholder that replaced it, for the verify
 * panel. detectRedactions returns redactable spans right to left, while
 * protect().placeholders is left to right with one token per occurrence. Sorting
 * the spans left to right aligns them index for index with placeholders; repeated
 * values reuse one token, so keep the first row per distinct value. */
export function buildMapping(spans: readonly Span[], placeholders: readonly string[]): MappingRow[] {
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  const rows: MappingRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ordered.length && i < placeholders.length; i++) {
    const s = ordered[i];
    if (seen.has(s.text)) continue;
    seen.add(s.text);
    rows.push({ placeholder: placeholders[i], label: s.label, value: s.text });
  }
  return rows;
}
