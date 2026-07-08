import type { Report } from "./score.ts";

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

export function renderResults(r: Report): string {
  const lines: string[] = [];
  lines.push("# Real-World Eval Results", "");
  lines.push(`Cases: ${r.cases}. Metric: char-level occurrence-anchored (same as the OpenPII bench).`, "");
  lines.push("## Headline", "");
  lines.push(`- protected_rate (overall): **${pct(r.overall.protectedRate)}** (${r.overall.protected}/${r.overall.redactTotal})`);
  lines.push(`- keep_violation_rate (overall): **${pct(r.overall.keepViolationRate)}** (${r.overall.violations}/${r.overall.keepTotal})`);
  for (const [tier, b] of Object.entries(r.byTier)) {
    lines.push(`- ${tier}: protected ${pct(b.protectedRate)} (${b.protected}/${b.redactTotal}), keep-violation ${pct(b.keepViolationRate)} (${b.violations}/${b.keepTotal})`);
  }
  lines.push("", "## By label (protected_rate)", "", "| label | protected | total | rate |", "| --- | --- | --- | --- |");
  for (const [label, l] of Object.entries(r.byLabel).sort((a, b) => a[1].protectedRate - b[1].protectedRate)) {
    lines.push(`| ${label} | ${l.protected} | ${l.total} | ${pct(l.protectedRate)} |`);
  }
  lines.push("", "## Leaks (redact terms not fully protected)", "");
  if (r.leaks.length === 0) lines.push("_none_");
  for (const l of r.leaks) lines.push(`- \`${l.caseId}\` ${l.label}: ${JSON.stringify(l.value)}`);
  lines.push("", "## Keep violations (landmines that got redacted)", "");
  if (r.violations.length === 0) lines.push("_none_");
  for (const v of r.violations) lines.push(`- \`${v.caseId}\`: ${JSON.stringify(v.value)}`);
  lines.push("");
  return lines.join("\n");
}
