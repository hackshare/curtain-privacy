/**
 * Informal-chat recall / over-redaction gate. Measures two conventions the shipped
 * detector handles unevenly, both targeted by the stashed speaker-label augmentation:
 *
 *  - speaker-labels: a name in speaker-prefix / (M)(F) / endearment / repeated
 *    position, including common-noun-homograph nicknames (Princess, Boy). Recall here
 *    sits well below generic per-language recall. --floor gates it so it cannot
 *    regress, and a targeted retrain has a fixed target to beat.
 *  - salutation sweep: a chat opener the detector pulls into the name span.
 *    reconcile.stripLeadingTitles trims these; the gate fails if any greeting is
 *    over-redacted, guarding that fix.
 *
 * Single-letter initials are reported for context only (a lone letter is not
 * identifying, so over-redacting it is accepted, not gated). Runs the shipped WASM
 * guard, the deterministic browser consumer path.
 *
 *   CURTAIN_MODEL=train/runs/model-ml-final bun eval/chat/gate.ts --floor 72
 */
import { ChatGuard } from "../../src/guard.ts";
import { detectNer } from "../../src/ner/classifier.ts";
import { resolveThresholds } from "../../src/thresholds.ts";
import { loadWasmClassifier } from "../wasm/classifier.ts";
import { arg } from "../bench/fetch.ts";
import { speakerCases, salutationCases, initialCases, scoreCase, type Case, type Tally } from "./fixtures.ts";

const modelDir = process.env.CURTAIN_MODEL ?? "train/runs/model-ml-final";
const floor = Number(arg("floor", "72"));

const classifier = await loadWasmClassifier(modelDir);
const guard = new ChatGuard({ ner: (t) => detectNer(t, classifier, resolveThresholds("balanced")) });

async function tally(cases: Case[]): Promise<Tally> {
  const acc: Tally = { redTot: 0, redHit: 0, keepTot: 0, keepViol: 0, leaks: [], over: [] };
  for (const c of cases) {
    const r = scoreCase(c, await guard.detectRedactions(c.text));
    acc.redTot += r.redTot; acc.redHit += r.redHit; acc.keepTot += r.keepTot; acc.keepViol += r.keepViol;
    acc.leaks.push(...r.leaks); acc.over.push(...r.over);
  }
  return acc;
}

const pct = (hit: number, tot: number) => (tot ? (100 * hit) / tot : 0);

const speaker = await tally(speakerCases());
const salutation = await tally(salutationCases());
const initials = await tally(initialCases());

const speakerRecall = pct(speaker.redHit, speaker.redTot);
console.log(`model: ${modelDir}`);
console.log(`speaker-label recall:      ${speakerRecall.toFixed(1)}%  (${speaker.redHit}/${speaker.redTot})   floor ${floor}%`);
console.log(`salutation over-redaction: ${pct(salutation.keepViol, salutation.keepTot).toFixed(1)}%  (${salutation.keepViol}/${salutation.keepTot})   [greeting swept into name]`);
console.log(`  salutation name recall:  ${pct(salutation.redHit, salutation.redTot).toFixed(1)}%  (${salutation.redHit}/${salutation.redTot})`);
console.log(`single-letter initials:    ${pct(initials.keepViol, initials.keepTot).toFixed(1)}% over-redacted  (${initials.keepViol}/${initials.keepTot})   [informational, not gated]`);

if (speaker.leaks.length) {
  console.log(`\nspeaker-label leaks (${[...new Set(speaker.leaks)].length} distinct):`);
  for (const l of [...new Set(speaker.leaks)].sort()) console.log(`  - ${l}`);
}

let failed = false;
if (speakerRecall < floor) {
  console.error(`\nGATE FAIL: speaker-label recall ${speakerRecall.toFixed(1)}% < ${floor}%`);
  failed = true;
}
if (salutation.keepViol > 0) {
  console.error(`\nGATE FAIL: ${salutation.keepViol} greeting(s) over-redacted: ${[...new Set(salutation.over)].join(", ")}`);
  failed = true;
}
if (failed) process.exit(1);
console.log(`\nPASS`);
