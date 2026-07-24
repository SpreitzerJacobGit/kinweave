/**
 * Trust-graph scorer (spec/10 §5) — capacity-bounded seeded flow.
 *
 * Trust flows from the community's seed set (guardians / `trustRoots`), decaying
 * each hop, split across each voucher's out-edges (per-voucher budget). NOT raw
 * degree: a member spreads a fraction of their OWN trust across everyone they
 * vouch for, so mass-vouching dilutes to ~0 and a Sybil ring with no path from a
 * root scores ~0. Hybrid rooting: shared seed + optional PERSONAL roots (bounded
 * boost) and personal DISTRUST (forces 0 + prunes that node's out-edges).
 * Computed locally, deterministically, from verifiable signed vouches.
 *
 * v1 = bounded-depth seeded flow behind a `TrustScorer` interface, so a fuller
 * EigenTrust / Advogato max-flow metric can drop in later without changing callers.
 */

import { verifyAttestation, issuerId } from './attestation';
import type { Attestation } from '../types/attestation';

export interface TrustScorer {
  /** Seeded-flow trust of a node fingerprint, in [0, 1]. */
  trust(nodeFp: string): number;
  /** Distinct vouchers of `subjectFp` who are themselves trusted (score ≥ threshold). */
  trustedVouchers(subjectFp: string): string[];
}

export interface TrustGraphOptions {
  /** Seed fingerprints (community trustRoots, as fingerprints). */
  roots: string[];
  /** Hybrid rooting: additional personal seed fingerprints (bounded weight). */
  personalRoots?: string[];
  /** Personal distrust: force these nodes to 0 and prune their out-edges. */
  distrust?: string[];
  now?: number;
  depth?: number; // hop limit (default 3)
  decay?: number; // per-hop attenuation (default 0.85)
  trustedThreshold?: number; // "trusted voucher" cutoff (default 0.1)
  personalRootWeight?: number; // bounded local boost for personal roots (default 0.5)
}

function addEdge(map: Map<string, Set<string>>, k: string, v: string): void {
  let s = map.get(k);
  if (!s) map.set(k, (s = new Set<string>()));
  s.add(v);
}

export function buildTrustGraph(atts: readonly Attestation[], opts: TrustGraphOptions): TrustScorer {
  const now = opts.now;
  const depth = opts.depth ?? 3;
  const decay = opts.decay ?? 0.85;
  const threshold = opts.trustedThreshold ?? 0.1;
  const personalRootWeight = opts.personalRootWeight ?? 0.5;
  const distrust = new Set(opts.distrust ?? []);

  // Revoked (issuer -> subject) edges.
  const revoked = new Set<string>();
  for (const a of atts) {
    if (a.type === 'vouch-revoke' && verifyAttestation(a, now)) revoked.add(`${issuerId(a)}->${a.subject}`);
  }

  // Build adjacency (voucher -> vouchees) and reverse index (subject -> vouchers).
  const out = new Map<string, Set<string>>();
  const vouchersOf = new Map<string, Set<string>>();
  for (const a of atts) {
    if (a.type !== 'vouch' || !verifyAttestation(a, now)) continue;
    const u = issuerId(a);
    const v = a.subject;
    if (revoked.has(`${u}->${v}`) || distrust.has(u)) continue;
    addEdge(out, u, v);
    addEdge(vouchersOf, v, u);
  }

  // Seed and propagate.
  const trust = new Map<string, number>();
  for (const r of opts.roots) if (!distrust.has(r)) trust.set(r, 1);
  for (const r of opts.personalRoots ?? []) if (!distrust.has(r)) trust.set(r, Math.max(trust.get(r) ?? 0, personalRootWeight));

  let frontier = new Map(trust);
  for (let d = 0; d < depth && frontier.size > 0; d++) {
    const next = new Map<string, number>();
    for (const [u, uScore] of frontier) {
      if (uScore <= 0 || distrust.has(u)) continue;
      const outs = out.get(u);
      if (!outs || outs.size === 0) continue;
      const share = (uScore * decay) / outs.size;
      for (const v of outs) {
        if (distrust.has(v)) continue;
        next.set(v, (next.get(v) ?? 0) + share);
        trust.set(v, Math.min(1, (trust.get(v) ?? 0) + share));
      }
    }
    frontier = next;
  }
  for (const d of distrust) trust.set(d, 0);

  return {
    trust: (fp) => (distrust.has(fp) ? 0 : trust.get(fp) ?? 0),
    trustedVouchers: (subjectFp) => {
      const vs = vouchersOf.get(subjectFp);
      if (!vs) return [];
      return [...vs].filter((u) => !distrust.has(u) && (trust.get(u) ?? 0) >= threshold);
    },
  };
}
