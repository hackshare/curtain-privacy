import { readFileSync } from "node:fs";
import type { PiiLabel } from "../../src/types.ts";

export interface GoldTerm {
  label?: PiiLabel;
  value: string;
  start: number;
  end: number;
}

export interface ResolvedCase {
  id: string;
  tier: "normal" | "messy";
  text: string;
  redact: GoldTerm[];
  keep: GoldTerm[];
}

interface RawTerm {
  label?: string;
  value: string;
  occurrence?: number;
}

interface RawCase {
  id: string;
  tier: string;
  text: string;
  redact?: RawTerm[];
  keep?: RawTerm[];
}

function resolveTerm(text: string, t: RawTerm, caseId: string): GoldTerm {
  const occurrence = t.occurrence ?? 0;
  let idx = -1;
  for (let k = 0; k <= occurrence; k++) {
    idx = text.indexOf(t.value, idx + 1);
    if (idx < 0) {
      throw new Error(`case ${caseId}: value ${JSON.stringify(t.value)} occurrence ${occurrence} not found`);
    }
  }
  return { label: t.label as PiiLabel | undefined, value: t.value, start: idx, end: idx + t.value.length };
}

export function loadCases(path: string): ResolvedCase[] {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const raw = JSON.parse(line) as RawCase;
    if (raw.tier !== "normal" && raw.tier !== "messy") {
      throw new Error(`case ${raw.id}: bad tier ${JSON.stringify(raw.tier)}`);
    }
    return {
      id: raw.id,
      tier: raw.tier,
      text: raw.text,
      redact: (raw.redact ?? []).map((t) => resolveTerm(raw.text, t, raw.id)),
      keep: (raw.keep ?? []).map((t) => resolveTerm(raw.text, t, raw.id)),
    };
  });
}
