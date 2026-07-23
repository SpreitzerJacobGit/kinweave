/**
 * Co-presence attestations (spec/10 §5) — the "we were physically together"
 * credential, minted mutually during an in-person QR exchange.
 *
 * Directional & non-self-mintable: each party SIGNS a receipt FOR the other,
 * bound to the single-use rendezvous nonce `rt` from the QR and a coarse
 * timestamp. So the receipt a holder presents was signed by SOMEONE ELSE and
 * cannot be forged alone. True proximity is not cryptographically provable
 * (a relay/wormhole between two remote, colluding parties is the residual risk);
 * the short `rt`-bound freshness window + a policy `maxAgeMs` bound it, and a BLE
 * round-trip-time check can tighten it later.
 */

import { mintAttestation, verifyAttestation } from './attestation';
import { fingerprint, type Identity } from './crypto';
import type { Attestation } from '../types/attestation';

export interface CoPresenceContext {
  /** Shared rendezvous nonce from the in-person QR exchange. */
  rt: string;
  /** Coarse timestamp (e.g. rounded to the hour) — never a precise time. */
  coarseTime: number;
  community?: string;
}

/**
 * I (signer) attest that `holderPubKey` was physically co-present with me, bound
 * to the shared `rt` + coarse time. The result is the receipt the HOLDER keeps.
 */
export function signCoPresence(signer: Identity, holderPubKey: string, ctx: CoPresenceContext): Attestation {
  return mintAttestation(signer, {
    type: 'co-presence',
    subject: fingerprint(holderPubKey),
    community: ctx.community,
    claims: { rt: ctx.rt, at: ctx.coarseTime, with: signer.id },
    issuedAt: ctx.coarseTime,
    nonce: ctx.rt,
  });
}

/** Both receipts from one in-person meet: each party keeps the one addressed to them. */
export function mintCoPresencePair(a: Identity, b: Identity, ctx: CoPresenceContext): { forA: Attestation; forB: Attestation } {
  return {
    forA: signCoPresence(b, a.pubKey, ctx), // B signs A's presence -> A keeps it
    forB: signCoPresence(a, b.pubKey, ctx), // A signs B's presence -> B keeps it
  };
}

/**
 * Verify a co-presence receipt a holder presents: it names the holder as subject,
 * was signed by someone else (not self-minted), is fresh, and the signature is valid.
 */
export function verifyCoPresence(att: Attestation, holderPubKey: string, now?: number, maxAgeMs?: number): boolean {
  if (att.type !== 'co-presence') return false;
  if (att.subject !== fingerprint(holderPubKey)) return false;
  if (att.issuer === holderPubKey) return false; // cannot self-mint
  if (maxAgeMs !== undefined && now !== undefined && att.issuedAt < now - maxAgeMs) return false;
  return verifyAttestation(att, now);
}
