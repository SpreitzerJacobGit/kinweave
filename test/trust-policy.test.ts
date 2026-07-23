import { describe, it, expect } from 'vitest';
import { Identity } from '../src/portable/crypto';
import { mintAttestation } from '../src/portable/attestation';
import { evaluatePolicy, type PolicyCtx } from '../src/portable/trust-policy';
import { OPEN_POLICY, type Attestation, type AttestationType, type TrustPolicy } from '../src/types/attestation';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const HOLDER = 'kw_holder';

let n = 0;
function att(type: AttestationType, issuer: Identity, opts: { issuedAt?: number; claims?: Record<string, unknown> } = {}): Attestation {
  return mintAttestation(issuer, { type, subject: HOLDER, community: 'kw_c', claims: opts.claims ?? {}, issuedAt: opts.issuedAt ?? NOW, nonce: `n${n++}` });
}

const ctx = (extra: Partial<PolicyCtx> = {}): PolicyCtx => ({ now: NOW, ...extra });

// co-presence OR (2 vouches)
const POLICY: TrustPolicy = { any: [{ require: 'co-presence', maxAgeMs: DAY }, { require: 'vouch', minCount: 2 }] };

describe('composable trust policy', () => {
  it('OPEN_POLICY passes an empty bundle', () => {
    expect(evaluatePolicy(OPEN_POLICY, [], ctx()).pass).toBe(true);
  });

  it('satisfies via co-presence branch', () => {
    const bundle = [att('co-presence', Identity.generate())];
    const r = evaluatePolicy(POLICY, bundle, ctx());
    expect(r.pass).toBe(true);
    expect(r.matched).toContain('co-presence');
  });

  it('satisfies via two vouches from DISTINCT issuers', () => {
    const bundle = [att('vouch', Identity.generate()), att('vouch', Identity.generate())];
    expect(evaluatePolicy(POLICY, bundle, ctx()).pass).toBe(true);
  });

  it('two vouches from the SAME issuer count as one (Sybil guard)', () => {
    const solo = Identity.generate();
    const bundle = [att('vouch', solo), att('vouch', solo)];
    const r = evaluatePolicy(POLICY, bundle, ctx());
    expect(r.pass).toBe(false);
    expect(r.missing).toContain('vouch×2');
  });

  it('fails an empty bundle and reports what is missing', () => {
    const r = evaluatePolicy(POLICY, [], ctx());
    expect(r.pass).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining(['co-presence', 'vouch×2']));
  });

  it('drops stale attestations past maxAgeMs', () => {
    const stale = [att('co-presence', Identity.generate(), { issuedAt: NOW - 2 * DAY })];
    expect(evaluatePolicy({ require: 'co-presence', maxAgeMs: DAY }, stale, ctx()).pass).toBe(false);
    const fresh = [att('co-presence', Identity.generate(), { issuedAt: NOW - DAY / 2 })];
    expect(evaluatePolicy({ require: 'co-presence', maxAgeMs: DAY }, fresh, ctx()).pass).toBe(true);
  });

  it('does not count an expired attestation', () => {
    const issuer = Identity.generate();
    const expired = mintAttestation(issuer, { type: 'vouch', subject: HOLDER, claims: {}, issuedAt: NOW - DAY, expiry: NOW - 1, nonce: 'x' });
    expect(evaluatePolicy({ require: 'vouch' }, [expired], ctx()).pass).toBe(false);
  });

  it('enforces the unique-human issuer allow-list', () => {
    const good = Identity.generate();
    const rogue = Identity.generate();
    const policy: TrustPolicy = { require: 'unique-human' };
    expect(evaluatePolicy(policy, [att('unique-human', good)], ctx({ issuerAllowList: [good.pubKey] })).pass).toBe(true);
    expect(evaluatePolicy(policy, [att('unique-human', rogue)], ctx({ issuerAllowList: [good.pubKey] })).pass).toBe(false);
  });

  it('all / atLeast combinators', () => {
    const cp = att('co-presence', Identity.generate());
    const uh = att('unique-human', Identity.generate());
    const both: TrustPolicy = { all: [{ require: 'co-presence' }, { require: 'unique-human' }] };
    expect(evaluatePolicy(both, [cp, uh], ctx()).pass).toBe(true);
    expect(evaluatePolicy(both, [cp], ctx()).pass).toBe(false);

    const two: TrustPolicy = { atLeast: 2, of: [{ require: 'co-presence' }, { require: 'unique-human' }, { require: 'vouch' }] };
    expect(evaluatePolicy(two, [cp, uh], ctx()).pass).toBe(true);
    expect(evaluatePolicy(two, [cp], ctx()).pass).toBe(false);
  });

  it('vouchStrength override replaces raw vouch counting (trust-graph seam)', () => {
    // One raw vouch, but the (future) scorer says it is worth 3.
    const bundle = [att('vouch', Identity.generate())];
    const policy: TrustPolicy = { require: 'vouch', minCount: 2 };
    expect(evaluatePolicy(policy, bundle, ctx()).pass).toBe(false); // raw count = 1
    expect(evaluatePolicy(policy, bundle, ctx({ vouchStrength: () => 3 })).pass).toBe(true);
  });
});
