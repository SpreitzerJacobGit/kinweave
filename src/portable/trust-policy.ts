/**
 * Composable trust policy evaluator (spec/10). A community's Sybil bar is a
 * data-described TrustPolicy; a joiner presents a bundle of verified attestations;
 * `evaluatePolicy` returns pass + which requirements matched / are still missing.
 *
 * Extensibility: leaf `require` clauses are dispatched through a per-type registry.
 * A new attestation type registers its own leaf evaluator without touching the
 * `all/any/atLeast` combinators. The default leaf evaluator counts DISTINCT
 * issuers (so one voucher can't satisfy `minCount: 2` alone) and honours
 * issuer allow-lists + freshness.
 *
 * The `vouch` strength is intentionally pluggable: the trust-graph milestone
 * swaps `ctx.vouchStrength` in so "2 vouches" means "trust-graph score ≥ 2 from
 * the community seed", not raw count — without changing this file's callers.
 */

import { verifyAttestation, issuerId } from './attestation';
import type { Attestation, AttestationType, TrustPolicy } from '../types/attestation';

export interface PolicyCtx {
  now: number;
  /** Community-wide accepted issuer keys (e.g. for `unique-human` PoP tokens). */
  issuerAllowList?: string[];
  /**
   * The holder the bundle is about. When set, only attestations whose `subject`
   * matches are counted — the joiner cannot present credentials about others.
   */
  subject?: string;
  /**
   * Optional override for how much vouch "count" a bundle is worth — supplied by
   * the trust-graph scorer once it exists. Returns an effective count.
   */
  vouchStrength?: (bundle: readonly Attestation[], leaf: RequireLeaf) => number;
}

export interface PolicyResult {
  pass: boolean;
  matched: string[];
  missing: string[];
}

export type RequireLeaf = Extract<TrustPolicy, { require: AttestationType }>;

/** How many effective, distinct-issuer matches a `require` leaf has in a bundle. */
export type LeafEvaluator = (leaf: RequireLeaf, bundle: readonly Attestation[], ctx: PolicyCtx) => number;

function leafLabel(leaf: RequireLeaf): string {
  const n = leaf.minCount ?? 1;
  return n > 1 ? `${leaf.require}×${n}` : leaf.require;
}

/** Default: count distinct issuers of unexpired, fresh, allow-listed matches. */
export const defaultLeafEvaluator: LeafEvaluator = (leaf, bundle, ctx) => {
  const allow =
    leaf.require === 'unique-human'
      ? intersect(leaf.issuers, ctx.issuerAllowList)
      : leaf.issuers;
  const issuers = new Set<string>();
  for (const a of bundle) {
    if (a.type !== leaf.require) continue;
    if (ctx.subject !== undefined && a.subject !== ctx.subject) continue; // subject-bound to the joiner
    if (issuerId(a) === a.subject) continue; // a self-issued credential proves nothing
    if (!verifyAttestation(a, ctx.now)) continue;
    if (allow && !allow.includes(a.issuer)) continue;
    if (leaf.maxAgeMs !== undefined && a.issuedAt < ctx.now - leaf.maxAgeMs) continue;
    issuers.add(a.issuer);
  }
  return issuers.size;
};

const registry: Partial<Record<AttestationType, LeafEvaluator>> = {};

/** Register a custom leaf evaluator for an attestation type (extension seam). */
export function registerLeafEvaluator(type: AttestationType, fn: LeafEvaluator): void {
  registry[type] = fn;
}

function evalLeaf(leaf: RequireLeaf, bundle: readonly Attestation[], ctx: PolicyCtx): boolean {
  const need = leaf.minCount ?? 1;
  if (leaf.require === 'vouch' && ctx.vouchStrength) return ctx.vouchStrength(bundle, leaf) >= need;
  const fn = registry[leaf.require] ?? defaultLeafEvaluator;
  return fn(leaf, bundle, ctx) >= need;
}

/**
 * Evaluate a policy against a joiner's attestation bundle. Attestations are
 * signature-checked here; the caller need only collect them.
 */
export function evaluatePolicy(policy: TrustPolicy, bundle: readonly Attestation[], ctx: PolicyCtx): PolicyResult {
  if ('require' in policy) {
    const ok = evalLeaf(policy, bundle, ctx);
    const label = leafLabel(policy);
    return { pass: ok, matched: ok ? [label] : [], missing: ok ? [] : [label] };
  }
  if ('all' in policy) {
    const parts = policy.all.map((p) => evaluatePolicy(p, bundle, ctx));
    return {
      pass: parts.every((r) => r.pass),
      matched: parts.flatMap((r) => r.matched),
      missing: parts.filter((r) => !r.pass).flatMap((r) => r.missing),
    };
  }
  if ('any' in policy) {
    const parts = policy.any.map((p) => evaluatePolicy(p, bundle, ctx));
    const win = parts.find((r) => r.pass);
    return win
      ? { pass: true, matched: win.matched, missing: [] }
      : { pass: false, matched: [], missing: dedupe(parts.flatMap((r) => r.missing)) };
  }
  // { atLeast, of }
  const parts = policy.of.map((p) => evaluatePolicy(p, bundle, ctx));
  const passing = parts.filter((r) => r.pass);
  return {
    pass: passing.length >= policy.atLeast,
    matched: passing.flatMap((r) => r.matched),
    missing: passing.length >= policy.atLeast ? [] : dedupe(parts.filter((r) => !r.pass).flatMap((r) => r.missing)),
  };
}

function intersect(a?: string[], b?: string[]): string[] | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.filter((x) => b.includes(x));
}
function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
