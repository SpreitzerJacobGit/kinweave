import { describe, it, expect } from 'vitest';
import { Identity } from '../src/portable/crypto';
import { mintCommunity, verifyCommunity, rotateCommunity, communityBody, type CommunityDescriptorV1 } from '../src/portable/community';
import type { TrustPolicy } from '../src/types/attestation';

const NOW = 1_700_000_000_000;

const policy: TrustPolicy = {
  any: [{ require: 'co-presence', maxAgeMs: 86_400_000 }, { require: 'vouch', minCount: 2 }],
};

describe('community identity + descriptor', () => {
  it('mints a self-certifying, verifiable community', () => {
    const founder = Identity.generate();
    const { descriptor } = mintCommunity({ name: 'Northside Climbers', founder: founder.pubKey, policy, relays: ['wss://r'] });
    expect(descriptor.kind).toBe('community');
    expect(descriptor.community.name).toBe('Northside Climbers');
    expect(descriptor.trustRoots).toEqual([founder.pubKey]);
    expect(descriptor.policy).toEqual(policy);
    expect(verifyCommunity(descriptor)).toBe(true);
  });

  it('binds the id to the community key (no impersonating another id)', () => {
    const { descriptor } = mintCommunity({ name: 'A' });
    const spoofed: CommunityDescriptorV1 = { ...descriptor, community: { ...descriptor.community, id: 'kw_deadbeefdeadbeef' } };
    expect(verifyCommunity(spoofed)).toBe(false);
  });

  it('rejects tampering with policy / relays / trustRoots', () => {
    const { descriptor } = mintCommunity({ name: 'A', policy, relays: ['wss://r'] });
    expect(verifyCommunity({ ...descriptor, policy: { require: 'co-presence' } })).toBe(false);
    expect(verifyCommunity({ ...descriptor, relays: ['wss://evil'] })).toBe(false);
    expect(verifyCommunity({ ...descriptor, trustRoots: ['kw_attacker'] })).toBe(false);
    expect(verifyCommunity({ ...descriptor, issuerAllowList: ['kw_evil'] })).toBe(false);
  });

  it('honours expiry when a clock is given', () => {
    const { descriptor } = mintCommunity({ name: 'A', ttlMs: 1000, now: NOW });
    expect(verifyCommunity(descriptor, NOW + 500)).toBe(true);
    expect(verifyCommunity(descriptor, NOW + 5000)).toBe(false);
  });

  it('rotates: bumps epoch + version, re-signs, still verifies', () => {
    const { descriptor, secret } = mintCommunity({ name: 'A', relays: ['wss://old'] });
    const rotated = rotateCommunity(descriptor, secret, { relays: ['wss://new'] });
    expect(rotated.community.epoch).toBe(descriptor.community.epoch + 1);
    expect(rotated.version).toBe(descriptor.version + 1);
    expect(rotated.community.id).toBe(descriptor.community.id);
    expect(rotated.relays).toEqual(['wss://new']);
    expect(verifyCommunity(rotated)).toBe(true);
  });

  it('refuses to rotate with a mismatched secret', () => {
    const { descriptor } = mintCommunity({ name: 'A' });
    const other = mintCommunity({ name: 'B' });
    expect(() => rotateCommunity(descriptor, other.secret)).toThrow(/does not match/);
  });

  it('communityBody excludes the signature', () => {
    const { descriptor } = mintCommunity({ name: 'A' });
    expect('sig' in communityBody(descriptor)).toBe(false);
  });
});
