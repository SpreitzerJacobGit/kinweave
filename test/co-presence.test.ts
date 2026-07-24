import { describe, it, expect } from 'vitest';
import { Identity, fingerprint } from '../src/portable/crypto';
import { signCoPresence, mintCoPresencePair, verifyCoPresence } from '../src/portable/co-presence';

const NOW = 1_700_000_000_000;
const ctx = { rt: 'rt-abc', coarseTime: NOW };

describe('co-presence attestations', () => {
  it('mints a mutual pair; each verifies for its holder', () => {
    const A = Identity.generate();
    const B = Identity.generate();
    const { forA, forB } = mintCoPresencePair(A, B, ctx);
    expect(verifyCoPresence(forA, A.pubKey, NOW)).toBe(true);
    expect(verifyCoPresence(forB, B.pubKey, NOW)).toBe(true);
    // forA is issued BY B (someone else), subject is A
    expect(forA.issuer).toBe(B.pubKey);
    expect(forA.subject).toBe(fingerprint(A.pubKey));
  });

  it('cannot be self-minted', () => {
    const A = Identity.generate();
    const self = signCoPresence(A, A.pubKey, ctx); // A signing their own presence
    expect(verifyCoPresence(self, A.pubKey, NOW)).toBe(false);
  });

  it('rejects a receipt presented by the wrong holder', () => {
    const A = Identity.generate();
    const B = Identity.generate();
    const { forA } = mintCoPresencePair(A, B, ctx);
    expect(verifyCoPresence(forA, B.pubKey, NOW)).toBe(false); // B presenting A's receipt
  });

  it('rejects tampering', () => {
    const A = Identity.generate();
    const B = Identity.generate();
    const { forA } = mintCoPresencePair(A, B, ctx);
    expect(verifyCoPresence({ ...forA, claims: { ...forA.claims, rt: 'other' } }, A.pubKey, NOW)).toBe(false);
  });

  it('enforces freshness (maxAgeMs)', () => {
    const A = Identity.generate();
    const B = Identity.generate();
    const { forA } = mintCoPresencePair(A, B, { rt: 'r', coarseTime: NOW - 3 * 86_400_000 });
    expect(verifyCoPresence(forA, A.pubKey, NOW, 86_400_000)).toBe(false); // 3 days old, 1 day max
    expect(verifyCoPresence(forA, A.pubKey, NOW)).toBe(true); // no maxAge → still valid signature
  });
});
