/**
 * Per-label model-score anchor thresholds and the runtime operating-point knob.
 * A span from the model is kept when its score >= the resolved threshold for its
 * label. Lower thresholds recover more (recall up, retention down); the operating
 * point scales the whole vector so deployers tune without retraining. Deterministic
 * classes score 1.0 and are unaffected.
 */
import type { PiiLabel } from "./types";

export type OperatingPoint = "aggressive" | "balanced" | "conservative";

export const DEFAULT_THRESHOLD = 0.4;

// Balanced per-label anchors. The tuner (eval/bench/tune-thresholds.ts) found that
// every label's retention stays flat all the way to the 0.15 rescue floor — the
// model's low-confidence spans are uniformly precise. Collapsing balanced to 0.15
// would erase the operating-point knob's range, so balanced stays at 0.4 (full
// dial range). The finding is evidence that the aggressive point (0.24) recovers
// recall cheaply.
const BALANCED: Partial<Record<PiiLabel, number>> = {
  GIVEN_NAME: 0.4,
  SURNAME: 0.4,
  PHONE: 0.4,
  URL: 0.4,
  EMAIL: 0.4,
  TAX_ID: 0.4,
  BANK_ACCOUNT: 0.4,
  ROUTING_NUMBER: 0.4,
  GOVERNMENT_ID: 0.4,
  PASSPORT: 0.4,
  DRIVERS_LICENSE: 0.4,
  BUILDING_NUMBER: 0.4,
  STREET_NAME: 0.4,
  SECONDARY_ADDRESS: 0.4,
  CITY: 0.4,
  STATE: 0.4,
  ZIP_CODE: 0.4,
};

const FACTOR: Record<OperatingPoint, number> = { aggressive: 0.6, balanced: 1.0, conservative: 1.6 };
const FLOOR = 0.15; // EXTEND_SCORE — never anchor below the hard rescue floor
const CEIL = 0.99;

function clamp(x: number): number {
  return Math.max(FLOOR, Math.min(CEIL, x));
}

export function resolveThresholds(
  operatingPoint: OperatingPoint = "balanced",
  overrides?: Partial<Record<PiiLabel, number>>,
): (label: string) => number {
  const factor = FACTOR[operatingPoint];
  if (factor === undefined) throw new Error(`unknown operating point: ${operatingPoint}`);
  const merged: Partial<Record<PiiLabel, number>> = { ...BALANCED, ...overrides };
  return (label: string) => clamp((merged[label as PiiLabel] ?? DEFAULT_THRESHOLD) * factor);
}
