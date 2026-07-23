/**
 * Web-of-trust vouching (spec/10 §5). A vouch is a signed edge "I vouch for this
 * member in this community"; a vouch-revoke withdraws it. These feed the
 * trust-graph scorer (trust-graph.ts). Pure wrappers over the attestation atom.
 */

import { mintAttestation } from './attestation';
import type { Identity } from './crypto';
import type { Attestation } from '../types/attestation';

export interface VouchOptions {
  /** Optional relative weight the voucher assigns (advisory; scorer may use it). */
  weight?: number;
  /** Mark this as an invite-tree edge (membership by invitation). */
  role?: 'invite';
  nonce?: string;
}

/** Voucher signs "I vouch for `subjectFp` in `community`". */
export function mintVouch(voucher: Identity, subjectFp: string, community: string, issuedAt: number, opts: VouchOptions = {}): Attestation {
  const claims: Record<string, unknown> = {};
  if (opts.weight !== undefined) claims.weight = opts.weight;
  if (opts.role) claims.role = opts.role;
  return mintAttestation(voucher, {
    type: 'vouch',
    subject: subjectFp,
    community,
    claims,
    issuedAt,
    nonce: opts.nonce ?? `vouch:${voucher.id}:${subjectFp}`,
  });
}

/** Voucher withdraws a prior vouch for `subjectFp` (prunes the edge in the scorer). */
export function mintVouchRevoke(voucher: Identity, subjectFp: string, community: string, issuedAt: number, nonce?: string): Attestation {
  return mintAttestation(voucher, {
    type: 'vouch-revoke',
    subject: subjectFp,
    community,
    claims: {},
    issuedAt,
    nonce: nonce ?? `revoke:${voucher.id}:${subjectFp}`,
  });
}
