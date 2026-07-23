import { describe, it, expect } from 'vitest';
import { Identity, fingerprint } from '../src/portable/crypto';
import { mintCommunity } from '../src/portable/community';
import { mintVouch } from '../src/portable/vouch';
import { mintCoPresencePair } from '../src/portable/co-presence';
import { mintAttestation } from '../src/portable/attestation';
import { evaluateConnect } from '../src/portable/community-gate';
import type { TrustPolicy } from '../src/types/attestation';

const NOW = 1_700_000_000_000;
const ctx = { now: NOW };

describe('community connect gate', () => {
  it('OPEN community: an empty bundle passes', () => {
    const { descriptor } = mintCommunity({ name: 'Open' });
    expect(evaluateConnect(descriptor, Identity.generate().id, [], ctx).pass).toBe(true);
  });

  it('co-presence policy: a valid receipt passes, empty fails', () => {
    const policy: TrustPolicy = { require: 'co-presence', maxAgeMs: 86_400_000 };
    const { descriptor } = mintCommunity({ name: 'C', policy });
    const joiner = Identity.generate();
    const host = Identity.generate();
    const { forA } = mintCoPresencePair(joiner, host, { rt: 'r', coarseTime: NOW });
    expect(evaluateConnect(descriptor, joiner.id, [forA], ctx).pass).toBe(true);
    expect(evaluateConnect(descriptor, joiner.id, [], ctx).pass).toBe(false);
  });

  it('vouch policy: two trusted vouchers pass, Sybil vouchers fail', () => {
    const r1 = Identity.generate();
    const r2 = Identity.generate();
    const policy: TrustPolicy = { require: 'vouch', minCount: 2 };
    const { descriptor } = mintCommunity({ name: 'C', trustRoots: [r1.pubKey, r2.pubKey], policy });
    const joiner = Identity.generate();
    const cid = descriptor.community.id;

    // two root vouchers → 2 trusted vouches → pass
    const good = [mintVouch(r1, joiner.id, cid, NOW), mintVouch(r2, joiner.id, cid, NOW)];
    expect(evaluateConnect(descriptor, joiner.id, good, ctx).pass).toBe(true);

    // one root voucher → only 1 trusted vouch → fail
    expect(evaluateConnect(descriptor, joiner.id, [mintVouch(r1, joiner.id, cid, NOW)], ctx).pass).toBe(false);

    // two Sybil (non-root) vouchers → 0 trusted → fail
    const s1 = Identity.generate();
    const s2 = Identity.generate();
    const sybil = [mintVouch(s1, joiner.id, cid, NOW), mintVouch(s2, joiner.id, cid, NOW)];
    expect(evaluateConnect(descriptor, joiner.id, sybil, ctx).pass).toBe(false);
  });

  it('is subject-bound: credentials about a DIFFERENT holder do not satisfy the policy', () => {
    const root = Identity.generate();
    const policy: TrustPolicy = { require: 'co-presence' };
    const { descriptor } = mintCommunity({ name: 'C', trustRoots: [root.pubKey], policy });
    const joiner = Identity.generate();
    const someoneElse = Identity.generate();
    const host = Identity.generate();
    // A co-presence receipt about SOMEONE ELSE — not the joiner — must not satisfy the policy.
    const { forA } = mintCoPresencePair(someoneElse, host, { rt: 'r', coarseTime: NOW });
    expect(evaluateConnect(descriptor, joiner.id, [forA], ctx).pass).toBe(false);
    // ...but it does satisfy the policy for the holder it is actually about.
    expect(evaluateConnect(descriptor, someoneElse.id, [forA], ctx).pass).toBe(true);
  });

  it('accepts a vouch CHAIN: intermediate-subject vouches feed the graph', () => {
    const root = Identity.generate();
    const m = Identity.generate();
    const policy: TrustPolicy = { require: 'vouch', minCount: 1 };
    const { descriptor } = mintCommunity({ name: 'C', trustRoots: [root.pubKey], policy });
    const joiner = Identity.generate();
    const cid = descriptor.community.id;
    // root→m (about m) and m→joiner (about joiner): joiner has 1 trusted voucher (m).
    const chain = [mintVouch(root, m.id, cid, NOW), mintVouch(m, joiner.id, cid, NOW)];
    expect(evaluateConnect(descriptor, joiner.id, chain, ctx).pass).toBe(true);
  });

  it('unique-human policy honours the descriptor issuer allow-list', () => {
    const issuer = Identity.generate();
    const rogue = Identity.generate();
    const policy: TrustPolicy = { require: 'unique-human' };
    const { descriptor } = mintCommunity({ name: 'C', issuerAllowList: [issuer.pubKey], policy });
    const joiner = Identity.generate();
    const token = (iss: Identity) => mintAttestation(iss, { type: 'unique-human', subject: joiner.id, claims: { redemptionTag: 'tag' }, issuedAt: NOW, nonce: 'n' });
    expect(evaluateConnect(descriptor, joiner.id, [token(issuer)], ctx).pass).toBe(true);
    expect(evaluateConnect(descriptor, joiner.id, [token(rogue)], ctx).pass).toBe(false);
  });

  it('personal distrust vetoes an otherwise-trusted voucher', () => {
    const root = Identity.generate();
    const m = Identity.generate();
    const policy: TrustPolicy = { require: 'vouch', minCount: 1 };
    const { descriptor } = mintCommunity({ name: 'C', trustRoots: [root.pubKey], policy });
    const joiner = Identity.generate();
    const cid = descriptor.community.id;
    const bundle = [mintVouch(root, m.id, cid, NOW), mintVouch(m, joiner.id, cid, NOW)];
    expect(evaluateConnect(descriptor, joiner.id, bundle, ctx).pass).toBe(true); // m is trusted → vouch counts
    expect(evaluateConnect(descriptor, joiner.id, bundle, { now: NOW, distrust: [fingerprint(m.pubKey)] }).pass).toBe(false);
  });
});
