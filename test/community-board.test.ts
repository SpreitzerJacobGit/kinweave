import { describe, it, expect } from 'vitest';
import { Node, type PresenceBeacon } from '../src/portable/crypto';
import { CommunityBoardStore, handleCommunityMsg, type BoardSocket, type CommunityServerMsg } from '../src/net/community-board';

const CID = 'kw_community000001';

function recorder(): { sock: BoardSocket; msgs: CommunityServerMsg[] } {
  const msgs: CommunityServerMsg[] = [];
  return { sock: { send: (d) => msgs.push(JSON.parse(d) as CommunityServerMsg) }, msgs };
}

describe('CommunityBoardStore', () => {
  it('accepts a valid signed beacon and lists it', () => {
    const store = new CommunityBoardStore();
    const b = new Node().beacon(CID, ['climbing'], 'northside');
    expect(store.post(CID, b)).toEqual({ ok: true });
    expect(store.beacons(CID)).toEqual([b]);
  });

  it('rejects a forged beacon', () => {
    const store = new CommunityBoardStore();
    const b = new Node().beacon(CID, ['climbing'], 'northside');
    const forged: PresenceBeacon = { ...b, hobbyTags: ['tampered'] };
    expect(store.post(CID, forged)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(store.beacons(CID)).toEqual([]);
  });

  it('rejects a beacon that names a different community', () => {
    const store = new CommunityBoardStore();
    const b = new Node().beacon('kw_othercommunity', ['x'], 'c');
    expect(store.post(CID, b)).toEqual({ ok: false, reason: 'community-mismatch' });
  });

  it('dedups by pubKey (last write wins)', () => {
    let t = 0;
    const store = new CommunityBoardStore({ now: () => t, minRepostMs: 0 });
    const node = new Node();
    store.post(CID, node.beacon(CID, ['v1'], 'c'));
    t = 1;
    store.post(CID, node.beacon(CID, ['v2'], 'c'));
    const live = store.beacons(CID);
    expect(live).toHaveLength(1);
    expect(live[0]!.hobbyTags).toEqual(['v2']);
  });

  it('expires beacons after the TTL', () => {
    let t = 0;
    const store = new CommunityBoardStore({ now: () => t, ttlMs: 1000 });
    store.post(CID, new Node().beacon(CID, ['x'], 'c'));
    t = 500;
    expect(store.beacons(CID)).toHaveLength(1);
    t = 1500;
    expect(store.beacons(CID)).toHaveLength(0);
  });

  it('enforces a per-community size cap but still allows updates', () => {
    const store = new CommunityBoardStore({ maxPerCommunity: 1, minRepostMs: 0 });
    const a = new Node();
    const b = new Node();
    expect(store.post(CID, a.beacon(CID, ['a'], 'c')).ok).toBe(true);
    expect(store.post(CID, b.beacon(CID, ['b'], 'c'))).toEqual({ ok: false, reason: 'community-full' });
    // updating the existing key is still allowed
    expect(store.post(CID, a.beacon(CID, ['a2'], 'c')).ok).toBe(true);
  });

  it('rate-limits re-posts by the same key', () => {
    let t = 0;
    const store = new CommunityBoardStore({ now: () => t, minRepostMs: 1000 });
    const node = new Node();
    expect(store.post(CID, node.beacon(CID, ['x'], 'c')).ok).toBe(true);
    t = 500;
    expect(store.post(CID, node.beacon(CID, ['x'], 'c'))).toEqual({ ok: false, reason: 'rate-limited' });
    t = 1000;
    expect(store.post(CID, node.beacon(CID, ['x'], 'c')).ok).toBe(true);
  });

  it('broadcasts a snapshot to subscribers on post, and stops after removeSocket', () => {
    const store = new CommunityBoardStore({ minRepostMs: 0 });
    const sub = recorder();
    const snapshot = store.subscribe(CID, sub.sock);
    expect(snapshot).toEqual([]);

    const poster = recorder();
    handleCommunityMsg(store, poster.sock, { t: 'post_beacon', community: CID, beacon: new Node().beacon(CID, ['x'], 'c') }, (m) => poster.sock.send(JSON.stringify(m)));
    expect(poster.msgs).toContainEqual({ t: 'post_ok', community: CID });
    const pushed = sub.msgs.find((m) => m.t === 'community_beacons');
    expect(pushed && pushed.t === 'community_beacons' && pushed.beacons).toHaveLength(1);

    store.removeSocket(sub.sock);
    const before = sub.msgs.length;
    store.post(CID, new Node().beacon(CID, ['y'], 'c'));
    expect(sub.msgs.length).toBe(before); // no more pushes
  });

  it('handleCommunityMsg replies post_rejected on a forged beacon', () => {
    const store = new CommunityBoardStore();
    const rec = recorder();
    const b = new Node().beacon(CID, ['x'], 'c');
    handleCommunityMsg(store, rec.sock, { t: 'post_beacon', community: CID, beacon: { ...b, geoCell: 'moved' } }, (m) => rec.sock.send(JSON.stringify(m)));
    expect(rec.msgs).toContainEqual({ t: 'post_rejected', community: CID, reason: 'bad-signature' });
  });
});
