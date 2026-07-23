/**
 * Attestation & trust-policy contracts — the composable verification spine.
 *
 * An Attestation is a signed, verifiable credential atom (spec/10). Verification
 * methods (co-presence, vouching, blinded proof-of-personhood) are just new
 * attestation TYPES; a community's Sybil bar is a data-described TrustPolicy that
 * combines them. New types register with the evaluator without changing the
 * combinators — that is the extensibility seam.
 *
 * PRIVACY INVARIANT: an attestation never carries PII. `subject`/`issuer` are
 * public keys or key fingerprints (pseudonymous); `claims` are coarse and must
 * never contain a phone number, exact location, or legal name. The blinded
 * `unique-human` token proves "a verified unique human" via an unlinkable tag,
 * never the underlying phone number.
 */

export type AttestationType = 'co-presence' | 'vouch' | 'vouch-revoke' | 'unique-human';

export interface Attestation {
  v: 1;
  type: AttestationType;
  /** Signing public key of the issuer (a member key, or a PoP issuer-service key). */
  issuer: string;
  /** Fingerprint ('kw_…') of the holder this attestation is about. Never PII. */
  subject: string;
  /** Community scope (id). Required for `vouch`/`vouch-revoke`; optional otherwise. */
  community?: string;
  /** Coarse, non-PII claims (e.g. { withMember: true }, { redemptionTag, issuerKeyId }). */
  claims: Record<string, unknown>;
  /** Coarse issue time (ms epoch, typically rounded) — never a precise timestamp. */
  issuedAt: number;
  /** Optional expiry (ms epoch). */
  expiry?: number;
  /** Freshness / anti-replay nonce. */
  nonce: string;
  /** Issuer's signature over `attestationBody`. */
  sig: string;
  /**
   * Co-presence only: the counterpart's signature over the SAME body. A
   * co-presence attestation is mutual — it cannot be self-minted, so it needs
   * both signatures. Verified by `verifyCoPresence` (added in the co-presence
   * milestone), not by the single-issuer `verifyAttestation`.
   */
  counterpartSig?: string;
}

/**
 * A data-described trust threshold. Combinators (`all`/`any`/`atLeast`) only ever
 * see boolean/count results; leaf `require` clauses match attestations of a type.
 */
export type TrustPolicy =
  | { all: TrustPolicy[] }
  | { any: TrustPolicy[] }
  | { atLeast: number; of: TrustPolicy[] }
  | {
      require: AttestationType;
      /** Restrict to these issuer keys (e.g. an allow-list of PoP issuers). */
      issuers?: string[];
      /** How many distinct matching attestations are needed (default 1). */
      minCount?: number;
      /** Reject attestations older than this many ms. */
      maxAgeMs?: number;
    };

/** The always-true policy (open community — no verification required). */
export const OPEN_POLICY: TrustPolicy = { atLeast: 0, of: [] };
