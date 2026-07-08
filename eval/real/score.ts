import type { Span } from "../../src/types.ts";
import { charCoverage } from "../bench/coverage.ts";
import type { GoldTerm, ResolvedCase } from "./load.ts";

export interface CaseScore {
  id: string;
  tier: "normal" | "messy";
  leaks: GoldTerm[];
  violations: GoldTerm[];
  redactTotal: number;
  redactProtected: number;
}

export function scoreCase(c: ResolvedCase, redactSpans: readonly Span[]): CaseScore {
  const leaks: GoldTerm[] = [];
  const violations: GoldTerm[] = [];
  let redactProtected = 0;
  for (const t of c.redact) {
    const { significant, covered } = charCoverage(t.value, t.start, redactSpans);
    if (significant === 0 || covered === significant) redactProtected += 1;
    else leaks.push(t);
  }
  for (const t of c.keep) {
    const { covered } = charCoverage(t.value, t.start, redactSpans);
    if (covered > 0) violations.push(t);
  }
  return { id: c.id, tier: c.tier, leaks, violations, redactTotal: c.redact.length, redactProtected };
}

interface Bucket {
  redactTotal: number;
  protected: number;
  protectedRate: number;
  keepTotal: number;
  violations: number;
  keepViolationRate: number;
}

export interface Report {
  cases: number;
  overall: Bucket;
  byTier: Record<string, Bucket>;
  byLabel: Record<string, { total: number; protected: number; protectedRate: number }>;
  leaks: { caseId: string; label: string; value: string }[];
  violations: { caseId: string; value: string }[];
}

function rate(n: number, d: number): number {
  return d === 0 ? 1 : n / d;
}

export function aggregate(cases: ResolvedCase[], scores: CaseScore[]): Report {
  const mkBucket = (): Bucket => ({ redactTotal: 0, protected: 0, protectedRate: 0, keepTotal: 0, violations: 0, keepViolationRate: 0 });
  const overall = mkBucket();
  const byTier: Record<string, Bucket> = {};
  const byLabel: Record<string, { total: number; protected: number; protectedRate: number }> = {};
  const leaks: Report["leaks"] = [];
  const violations: Report["violations"] = [];

  const byId = new Map(cases.map((c) => [c.id, c]));
  for (const s of scores) {
    const tier = (byTier[s.tier] ??= mkBucket());
    for (const b of [overall, tier]) {
      b.redactTotal += s.redactTotal;
      b.protected += s.redactProtected;
      b.keepTotal += byId.get(s.id)!.keep.length;
      b.violations += s.violations.length;
    }
    const c = byId.get(s.id)!;
    const leakedKeys = new Set(s.leaks.map((t) => `${t.start}:${t.end}`));
    for (const t of c.redact) {
      const label = t.label ?? "UNLABELED";
      const l = (byLabel[label] ??= { total: 0, protected: 0, protectedRate: 0 });
      l.total += 1;
      if (!leakedKeys.has(`${t.start}:${t.end}`)) l.protected += 1;
    }
    for (const t of s.leaks) leaks.push({ caseId: s.id, label: t.label ?? "UNLABELED", value: t.value });
    for (const t of s.violations) violations.push({ caseId: s.id, value: t.value });
  }
  for (const b of [overall, ...Object.values(byTier)]) {
    b.protectedRate = rate(b.protected, b.redactTotal);
    b.keepViolationRate = b.keepTotal === 0 ? 0 : b.violations / b.keepTotal;
  }
  for (const l of Object.values(byLabel)) l.protectedRate = rate(l.protected, l.total);

  return { cases: scores.length, overall, byTier, byLabel, leaks, violations };
}
