/**
 * Community connect gate (spec/10 §4) — the enforcement seam. Given a joiner's
 * attestation bundle (carried inside the sealed HELLO) and a community
 * descriptor, decide whether the joiner clears the community's trust policy. Runs
 * BEFORE G1 in the negotiation driver, so it gates connectability without
 * touching owner consent.
 *
 * Trust is computed locally from the bundle's vouches, seeded by the descriptor's
 * `trustRoots` (+ the owner's personal roots / distrust for hybrid rooting). The
 * joiner's fingerprint (`subjectFp`) is passed explicitly: leaf requirements
 * (co-presence, vouch, unique-human) only count credentials ABOUT the joiner,
 * while a vouch CHAIN's intermediate-subject vouches still feed the trust graph.
 *
 * NOTE: binding `subjectFp` to the actual sender's transport key is done where
 * the sealed envelope is opened (the Session, a later milestone); this module
 * takes the claimed joiner identity and decides whether the policy is satisfied.
 */

import { evaluatePolicy, type PolicyResult } from './trust-policy';
import { buildTrustGraph } from './trust-graph';
import { fingerprint } from './crypto';
import type { Attestation } from '../types/attestation';
import type { CommunityDescriptorV1 } from './community';

export interface ConnectContext {
  now: number;
  /** Hybrid rooting: the owner's personal trusted roots (fingerprints). */
  personalRoots?: string[];
  /** The owner's personal distrust (fingerprints) — vetoes locally. */
  distrust?: string[];
}

export interface ConnectVerdict extends PolicyResult {
  /** The joiner the bundle was evaluated for. */
  subject: string;
}

/** Evaluate whether joiner `subjectFp`'s bundle satisfies a community's trust policy. */
export function evaluateConnect(descriptor: CommunityDescriptorV1, subjectFp: string, bundle: readonly Attestation[], ctx: ConnectContext): ConnectVerdict {
  const roots = descriptor.trustRoots.map(fingerprint);
  const scorer = buildTrustGraph(bundle, { roots, personalRoots: ctx.personalRoots, distrust: ctx.distrust, now: ctx.now });

  const result = evaluatePolicy(descriptor.policy, bundle, {
    now: ctx.now,
    issuerAllowList: descriptor.issuerAllowList,
    subject: subjectFp || undefined,
    vouchStrength: () => (subjectFp ? scorer.trustedVouchers(subjectFp).length : 0),
  });
  return { ...result, subject: subjectFp };
}

/** A gate for the negotiation driver: does joiner `subjectFp`'s bundle satisfy the policy? */
export function makeConnectGate(descriptor: CommunityDescriptorV1, ctx: ConnectContext): (subjectFp: string, bundle: readonly Attestation[]) => boolean {
  return (subjectFp, bundle) => evaluateConnect(descriptor, subjectFp, bundle, ctx).pass;
}
