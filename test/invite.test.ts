import { describe, it, expect } from 'vitest';
import { Node } from '../src/portable/crypto';
import { makeInvite, encodeKw1, decodeKw1, verifyInvite, inviteUrl, parseKw1FromHash, type InviteV1 } from '../src/portable/invite';
import { mintCommunity } from '../src/portable/community';

const NOW = 1_700_000_000_000;

describe('kw1 invite envelope', () => {
  it('encodes → decodes an invite round-trip', () => {
    const node = new Node();
    const inv = makeInvite(node, { hobbyTags: ['climbing'], geoCell: 'cellA', relays: ['wss://r1', 'wss://r2'] });
    const round = decodeKw1(encodeKw1(inv));
    expect(round).not.toBeNull();
    expect(round!.kind).toBe('invite');
    expect(round).toEqual(inv);
    expect(verifyInvite(round as InviteV1)).toBe(true);
  });

  it('rejects a tampered beacon', () => {
    const node = new Node();
    const inv = makeInvite(node, { hobbyTags: ['x'], geoCell: 'c' });
    const bad: InviteV1 = { ...inv, beacon: { ...inv.beacon, hobbyTags: ['tampered'] } };
    expect(verifyInvite(bad)).toBe(false);
  });

  it('enforces expiry when a clock is supplied', () => {
    const node = new Node();
    const inv = makeInvite(node, { hobbyTags: ['x'], geoCell: 'c', ttlMs: 1000, now: NOW });
    expect(verifyInvite(inv, NOW + 500)).toBe(true);
    expect(verifyInvite(inv, NOW + 2000)).toBe(false);
    // exp: 0 (default) means no expiry
    const forever = makeInvite(node, { hobbyTags: ['x'], geoCell: 'c' });
    expect(verifyInvite(forever, NOW + 10 ** 12)).toBe(true);
  });

  it('produces url-safe payloads and works on the browser (btoa/atob) path', () => {
    const node = new Node();
    const inv = makeInvite(node, { hobbyTags: ['a', 'b', 'c'], geoCell: 'cell-xyz', relays: ['wss://relay/one'] });
    const saved = (globalThis as { Buffer?: unknown }).Buffer;
    try {
      (globalThis as { Buffer?: unknown }).Buffer = undefined; // force the btoa/atob branch
      const enc = encodeKw1(inv);
      expect(enc).not.toMatch(/[+/=]/); // url-safe, unpadded
      const dec = decodeKw1(enc);
      expect(dec).toEqual(inv);
    } finally {
      (globalThis as { Buffer?: unknown }).Buffer = saved;
    }
  });

  it('parses new #kw1= links and legacy #pair= links', () => {
    const node = new Node();
    const inv = makeInvite(node, { hobbyTags: ['climbing'], geoCell: 'c' });
    const url = inviteUrl('https://host.example', inv);
    expect(url).toContain('/#kw1=');
    const fromNew = parseKw1FromHash(new URL(url).hash);
    expect(fromNew).toEqual(inv);

    // legacy: btoa(JSON.stringify({ v:1, beacon, rt })) at #pair=
    const legacyPayload = Buffer.from(JSON.stringify({ v: 1, beacon: inv.beacon, rt: 'abc' }), 'utf8').toString('base64');
    const fromLegacy = parseKw1FromHash(`#pair=${legacyPayload}`);
    expect(fromLegacy).not.toBeNull();
    expect(fromLegacy!.kind).toBe('invite');
    expect(verifyInvite(fromLegacy as InviteV1)).toBe(true);
  });

  it('carries a community descriptor as the other kw1 kind', () => {
    const { descriptor } = mintCommunity({ name: 'Northside Climbers', relays: ['wss://r'] });
    const round = decodeKw1(encodeKw1(descriptor));
    expect(round).not.toBeNull();
    expect(round!.kind).toBe('community');
    expect(round).toEqual(descriptor);
  });

  it('returns null on garbage', () => {
    expect(decodeKw1('not-base64!!')).toBeNull();
    expect(parseKw1FromHash('#nothing=here')).toBeNull();
  });
});
