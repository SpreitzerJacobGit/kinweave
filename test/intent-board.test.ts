import { describe, it, expect } from 'vitest';
import { Node, type OpenCall } from '../src/portable/crypto';
import { IntentBoardStore, handleIntentMsg, type IntentBoardSocket, type IntentServerMsg } from '../src/net/intent-board';

const CID = 'kw_community000001';
const FAR = 10_000_000; // an expiry comfortably in the future for the injected clock

function call(node: Node, over: Partial<Parameters<Node['openCall']>[0]> = {}): OpenCall {
  return node.openCall({
    community: CID,
    activityClass: 'coffee',
    timeBand: 'weekend_day',
    geoCell: 'downtown',
    groupSize: 'one_on_one',
    expiry: FAR,
    nonce: 'n1',
    ...over,
  });
}

function recorder(): { sock: IntentBoardSocket; msgs: IntentServerMsg[] } {
  const msgs: IntentServerMsg[] = [];
  return { sock: { send: (d) => msgs.push(JSON.parse(d) as IntentServerMsg) }, msgs };
}

describe('IntentBoardStore', () => {
  it('accepts a valid signed call and lists it', () => {
    const store = new IntentBoardStore({ now: () => 0 });
    const c = call(new Node());
    expect(store.post(CID, c)).toEqual({ ok: true });
    expect(store.calls(CID)).toEqual([c]);
  });

  it('rejects a forged call', () => {
    const store = new IntentBoardStore({ now: () => 0 });
    const c = call(new Node());
    const forged: OpenCall = { ...c, activityClass: 'tampered' };
    expect(store.post(CID, forged)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(store.calls(CID)).toEqual([]);
  });

  it('rejects a call that names a different community', () => {
    const store = new IntentBoardStore({ now: () => 0 });
    const c = call(new Node(), { community: 'kw_othercommunity' });
    expect(store.post(CID, c)).toEqual({ ok: false, reason: 'community-mismatch' });
  });

  it('rejects an already-expired call', () => {
    const store = new IntentBoardStore({ now: () => 1000 });
    const c = call(new Node(), { expiry: 500 });
    expect(store.post(CID, c)).toEqual({ ok: false, reason: 'expired' });
  });

  it('dedups by pubKey (one active call per caller, last write wins)', () => {
    let t = 0;
    const store = new IntentBoardStore({ now: () => t, minRepostMs: 0 });
    const node = new Node();
    store.post(CID, call(node, { activityClass: 'coffee', nonce: 'a' }));
    t = 1;
    store.post(CID, call(node, { activityClass: 'games', nonce: 'b' }));
    const live = store.calls(CID);
    expect(live).toHaveLength(1);
    expect(live[0]!.activityClass).toEqual('games');
  });

  it('sweeps a call at its own stated expiry', () => {
    let t = 0;
    const store = new IntentBoardStore({ now: () => t, ttlMs: 1_000_000 });
    store.post(CID, call(new Node(), { expiry: 1000 }));
    t = 500;
    expect(store.calls(CID)).toHaveLength(1);
    t = 1000;
    expect(store.calls(CID)).toHaveLength(0);
  });

  it('sweeps a call at the board TTL ceiling even if its expiry is later', () => {
    let t = 0;
    const store = new IntentBoardStore({ now: () => t, ttlMs: 1000 });
    store.post(CID, call(new Node(), { expiry: FAR }));
    t = 500;
    expect(store.calls(CID)).toHaveLength(1);
    t = 1001;
    expect(store.calls(CID)).toHaveLength(0);
  });

  it('enforces a per-community size cap but still allows updates', () => {
    const store = new IntentBoardStore({ now: () => 0, maxPerCommunity: 1, minRepostMs: 0 });
    const a = new Node();
    const b = new Node();
    expect(store.post(CID, call(a, { nonce: 'a' })).ok).toBe(true);
    expect(store.post(CID, call(b, { nonce: 'b' }))).toEqual({ ok: false, reason: 'community-full' });
    // updating the existing key is still allowed
    expect(store.post(CID, call(a, { nonce: 'a2', activityClass: 'games' })).ok).toBe(true);
  });

  it('rate-limits re-posts by the same key', () => {
    let t = 0;
    const store = new IntentBoardStore({ now: () => t, minRepostMs: 1000 });
    const node = new Node();
    expect(store.post(CID, call(node, { nonce: 'a' })).ok).toBe(true);
    t = 500;
    expect(store.post(CID, call(node, { nonce: 'b' }))).toEqual({ ok: false, reason: 'rate-limited' });
    t = 1000;
    expect(store.post(CID, call(node, { nonce: 'c' })).ok).toBe(true);
  });

  it('broadcasts a snapshot to subscribers on post, and stops after removeSocket', () => {
    const store = new IntentBoardStore({ now: () => 0, minRepostMs: 0 });
    const sub = recorder();
    const snapshot = store.subscribe(CID, sub.sock);
    expect(snapshot).toEqual([]);

    const poster = recorder();
    handleIntentMsg(store, poster.sock, { t: 'post_call', community: CID, call: call(new Node()) }, (m) => poster.sock.send(JSON.stringify(m)));
    expect(poster.msgs).toContainEqual({ t: 'call_ok', community: CID });
    const pushed = sub.msgs.find((m) => m.t === 'community_calls');
    expect(pushed && pushed.t === 'community_calls' && pushed.calls).toHaveLength(1);

    store.removeSocket(sub.sock);
    const before = sub.msgs.length;
    store.post(CID, call(new Node(), { nonce: 'y' }));
    expect(sub.msgs.length).toBe(before); // no more pushes
  });

  it('handleIntentMsg replies call_rejected on a forged call', () => {
    const store = new IntentBoardStore({ now: () => 0 });
    const rec = recorder();
    const c = call(new Node());
    handleIntentMsg(store, rec.sock, { t: 'post_call', community: CID, call: { ...c, geoCell: 'moved' } }, (m) => rec.sock.send(JSON.stringify(m)));
    expect(rec.msgs).toContainEqual({ t: 'call_rejected', community: CID, reason: 'bad-signature' });
  });
});
