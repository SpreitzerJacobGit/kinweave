import { describe, it, expect } from 'vitest';
import { Identity } from '../src/portable/crypto';
import { mintAttestation, verifyAttestation, attestationBody, issuerId } from '../src/portable/attestation';

const NOW = 1_700_000_000_000;

describe('attestation credential atom', () => {
  it('mints and verifies a single-issuer attestation', () => {
    const issuer = Identity.generate();
    const a = mintAttestation(issuer, { type: 'vouch', subject: 'kw_holder', community: 'kw_c', claims: { role: 'invite' }, issuedAt: NOW, nonce: 'n1' });
    expect(a.issuer).toBe(issuer.pubKey);
    expect(verifyAttestation(a, NOW)).toBe(true);
    expect(issuerId(a)).toBe(issuer.id);
  });

  it('rejects tampered claims / subject', () => {
    const issuer = Identity.generate();
    const a = mintAttestation(issuer, { type: 'vouch', subject: 'kw_holder', community: 'kw_c', claims: {}, issuedAt: NOW, nonce: 'n1' });
    expect(verifyAttestation({ ...a, claims: { forged: true } })).toBe(false);
    expect(verifyAttestation({ ...a, subject: 'kw_someone_else' })).toBe(false);
    expect(verifyAttestation({ ...a, issuer: Identity.generate().pubKey })).toBe(false);
  });

  it('enforces expiry', () => {
    const issuer = Identity.generate();
    const a = mintAttestation(issuer, { type: 'unique-human', subject: 'kw_h', claims: {}, issuedAt: NOW, expiry: NOW + 1000, nonce: 'n' });
    expect(verifyAttestation(a, NOW + 500)).toBe(true);
    expect(verifyAttestation(a, NOW + 2000)).toBe(false);
  });

  it('body excludes signatures and carries no PII field', () => {
    const issuer = Identity.generate();
    const a = mintAttestation(issuer, { type: 'unique-human', subject: 'kw_h', claims: { redemptionTag: 'tag123' }, issuedAt: NOW, nonce: 'n' });
    const body = attestationBody(a);
    expect('sig' in body).toBe(false);
    expect('counterpartSig' in body).toBe(false);
    expect(JSON.stringify(a)).not.toMatch(/phone/i);
  });
});
