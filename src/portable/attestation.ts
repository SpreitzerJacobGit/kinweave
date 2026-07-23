/**
 * Attestation runtime — mint & verify signed credential atoms. Pure @noble,
 * browser+node safe. Follows the beacon signing idiom in crypto.ts: a fixed-key
 * `attestationBody()` extractor so signer and verifier canonicalize identically.
 *
 * This module ships the model + single-issuer verification (vouch, vouch-revoke,
 * unique-human). Co-presence is mutual and gets its own `verifyCoPresence` in the
 * co-presence milestone; the shared body extractor here is what it will sign.
 */

import { verifySig, fingerprint, type Identity } from './crypto';
import type { Attestation, AttestationType } from '../types/attestation';

/** The signed portion of an attestation — fixed key order, excludes signatures. */
export function attestationBody(a: Omit<Attestation, 'sig' | 'counterpartSig'>) {
  return {
    v: a.v,
    type: a.type,
    issuer: a.issuer,
    subject: a.subject,
    community: a.community ?? null,
    claims: a.claims,
    issuedAt: a.issuedAt,
    expiry: a.expiry ?? null,
    nonce: a.nonce,
  };
}

export interface MintAttestationInput {
  type: AttestationType;
  subject: string;
  community?: string;
  claims?: Record<string, unknown>;
  issuedAt: number;
  expiry?: number;
  nonce: string;
}

/** Sign an attestation with a member/issuer identity. */
export function mintAttestation(issuer: Identity, input: MintAttestationInput): Attestation {
  const body = {
    v: 1 as const,
    type: input.type,
    issuer: issuer.pubKey,
    subject: input.subject,
    community: input.community,
    claims: input.claims ?? {},
    issuedAt: input.issuedAt,
    expiry: input.expiry,
    nonce: input.nonce,
  };
  return { ...body, sig: issuer.sign(attestationBody(body)) };
}

/**
 * Verify a single-issuer attestation: unexpired + the issuer's signature is
 * valid over the body. Does NOT check co-presence's mutual `counterpartSig`
 * (use `verifyCoPresence` for that) and does NOT check policy membership.
 */
export function verifyAttestation(a: Attestation, now?: number): boolean {
  if (a.v !== 1) return false;
  if (a.expiry !== undefined && now !== undefined && a.expiry < now) return false;
  return verifySig(a.issuer, attestationBody(a), a.sig);
}

/** The fingerprint of an attestation's issuer (its key identity in the graph). */
export function issuerId(a: Attestation): string {
  return fingerprint(a.issuer);
}
