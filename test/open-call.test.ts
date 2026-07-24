import { describe, it, expect } from 'vitest';
import { Node, callBody, verifySig, type OpenCall } from '../src/portable/crypto';

const CID = 'kw_community000001';

function make(node: Node): OpenCall {
  return node.openCall({
    community: CID,
    activityClass: 'coffee',
    timeBand: 'weekend_day',
    geoCell: 'downtown',
    groupSize: 'one_on_one',
    expiry: 10_000_000,
    nonce: 'n1',
  });
}

describe('OpenCall atom', () => {
  it('signs a call that verifies against the caller identity', () => {
    const node = new Node();
    const c = make(node);
    expect(c.pubKey).toBe(node.identity.pubKey);
    expect(c.encPubKey).toBe(node.enc.pubKey);
    expect(verifySig(c.pubKey, callBody(c), c.sig)).toBe(true);
  });

  it('fails verification when any signed field is tampered', () => {
    const c = make(new Node());
    for (const mut of [
      { ...c, activityClass: 'games' },
      { ...c, timeBand: 'weekday_eve' },
      { ...c, geoCell: 'northside' },
      { ...c, groupSize: 'small' as const },
      { ...c, expiry: c.expiry + 1 },
      { ...c, nonce: 'n2' },
    ]) {
      expect(verifySig(mut.pubKey, callBody(mut), mut.sig)).toBe(false);
    }
  });

  it('carries only coarse T0/T1 fields — no PII, coordinate, exact time, or raw vector on the wire', () => {
    const c = make(new Node());
    const keys = Object.keys(c).sort();
    expect(keys).toEqual(
      ['activityClass', 'community', 'encPubKey', 'expiry', 'geoCell', 'groupSize', 'nonce', 'pubKey', 'sig', 'timeBand'].sort(),
    );
    // Guard against Zone-O fields ever leaking into the wire atom.
    const wire = JSON.stringify(c);
    for (const banned of ['homeCoordinate', 'legalName', 'firstName', 'contact', 'interestVector', 'lat', 'lng']) {
      expect(wire).not.toContain(banned);
    }
  });
});
