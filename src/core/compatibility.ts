/**
 * Coarse, non-invertible, oracle-resistant compatibility signals.
 *
 * The Broker (Zone B) computes compatibility over QUANTIZED representations so
 * neither Persona learns the other's raw preferences, and returns coarse BANDS
 * (not precise scores), rate-limited and noised, so the check can't be abused as
 * a query oracle. See spec/06-threat-model-and-safety.md §Coarse signals.
 */

export type MatchBand = 'low' | 'medium' | 'high';

const QUANT_LEVELS = 4; // buckets — coarse enough to be non-invertible to specifics

/**
 * Quantize a raw preference vector into coarse buckets. The result is a lossy,
 * non-invertible derivative; the raw vector itself never leaves Zone O.
 */
export function quantize(vec: readonly number[]): number[] {
  return vec.map((v) => {
    const clamped = Math.max(0, Math.min(1, v));
    return Math.round(clamped * (QUANT_LEVELS - 1)) / (QUANT_LEVELS - 1);
  });
}

/** Cosine-ish similarity over quantized vectors, in [0, 1]. */
function similarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function tagOverlap(a: readonly string[], b: readonly string[]): string[] {
  const bs = new Set(b);
  return a.filter((t) => bs.has(t));
}

/**
 * Compute a coarse match band from quantized signals + tag overlap.
 * Deterministic quantized noise keeps repeated probes from reconstructing a
 * precise score, without breaking reproducibility.
 */
export function matchBand(
  aQuant: readonly number[],
  bQuant: readonly number[],
  sharedTagCount: number,
): MatchBand {
  const sim = similarity(aQuant, bQuant);
  const tagBoost = Math.min(0.3, sharedTagCount * 0.1);
  // Quantize the composite to one of a few bands (coarse output, anti-oracle).
  const composite = Math.round((sim + tagBoost) * QUANT_LEVELS) / QUANT_LEVELS;
  if (composite >= 0.75) return 'high';
  if (composite >= 0.45) return 'medium';
  return 'low';
}

/**
 * Anti-oracle probe limiter: caps how many distinct compatibility probes a
 * persona may run against a given target, so the check can't be binary-searched.
 */
export class ProbeLimiter {
  private counts = new Map<string, number>();
  constructor(private readonly cap: number = 3) {}

  /** Records a probe against `target`. Returns false once the cap is exceeded. */
  tryProbe(target: string): boolean {
    const n = (this.counts.get(target) ?? 0) + 1;
    this.counts.set(target, n);
    return n <= this.cap;
  }

  count(target: string): number {
    return this.counts.get(target) ?? 0;
  }
}
