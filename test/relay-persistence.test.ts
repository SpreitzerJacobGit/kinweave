import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { startServer, type RunningServer } from '../server/index';
import { Node, callBody, beaconBody } from '../src/portable/crypto';
import { connectRelay } from '../src/portable/relay-connect';
import { fileSink, nullSink, type RelaySnapshot } from '../src/net/relay-persistence';
import { IntentBoardStore } from '../src/net/intent-board';
import { CommunityBoardStore } from '../src/net/community-board';

describe('relay persistence — snapshots survive a restart, expiry is honored', () => {
  const tmpDirs: string[] = [];
  let server: RunningServer | undefined;
  const freshDir = () => {
    const d = mkdtempSync(join(tmpdir(), 'kw-persist-'));
    tmpDirs.push(d);
    return d;
  };

  afterEach(async () => {
    await server?.close();
    server = undefined;
    delete process.env.KINWEAVE_DATA_DIR;
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('nullSink is inert', () => {
    expect(nullSink.enabled).toBe(false);
    expect(nullSink.load()).toBeNull();
    nullSink.save(() => ({ v: 1, counter: 0, mail: [], intents: { boards: [], lastPost: [] }, community: { boards: [], lastPost: [] } }));
    nullSink.flush(); // no throw
  });

  it('fileSink round-trips a snapshot (flush writes, a fresh sink reads it back)', () => {
    const dir = freshDir();
    const snap: RelaySnapshot = {
      v: 1,
      counter: 7,
      mail: [['recipient-fp', [{ mailId: 'mail-7', env: { to: 'recipient-fp', fromEnc: 'enc', box: { n: 'n', ct: 'ct' }, sig: 'sig' } as never }]]],
      intents: { boards: [], lastPost: [] },
      community: { boards: [], lastPost: [] },
    };
    const a = fileSink(dir, 1000);
    expect(a.load()).toBeNull(); // nothing yet
    a.save(() => snap);
    a.flush(); // force the debounced write out now
    const b = fileSink(dir);
    const got = b.load();
    expect(got?.counter).toBe(7);
    expect(got?.mail[0]?.[0]).toBe('recipient-fp');
    expect(got?.mail[0]?.[1][0]?.mailId).toBe('mail-7');
  });

  it('IntentBoardStore snapshot restores live calls and drops expired ones', () => {
    let t = 1000;
    const src = new IntentBoardStore({ now: () => t });
    const caller = new Node();
    const community = 'kw:c:demo';
    const mkCall = (expiry: number) => {
      const partial = {
        pubKey: caller.identity.pubKey,
        encPubKey: caller.enc.pubKey,
        community,
        activityClass: 'coffee',
        timeBand: 'weekend_day',
        geoCell: 'cellA',
        groupSize: 'one_on_one' as const,
        expiry,
        nonce: 'n1',
      };
      return { ...partial, sig: caller.identity.sign(callBody(partial)) };
    };
    expect(src.post(community, mkCall(t + 5000)).ok).toBe(true);

    const snap = src.toSnapshot();
    // Restore into a store whose clock is BEFORE expiry — the call survives.
    const live = new IntentBoardStore({ now: () => 1000 });
    live.loadSnapshot(snap);
    expect(live.calls(community)).toHaveLength(1);

    // Restore into a store whose clock is AFTER expiry — the call is dropped.
    const dead = new IntentBoardStore({ now: () => 999999 });
    dead.loadSnapshot(snap);
    expect(dead.calls(community)).toHaveLength(0);
  });

  it('CommunityBoardStore snapshot restores live beacons', () => {
    const src = new CommunityBoardStore({ now: () => 1000 });
    const peer = new Node();
    const community = 'kw:c:demo';
    const partial = { pubKey: peer.identity.pubKey, encPubKey: peer.enc.pubKey, community, hobbyTags: ['coffee'], geoCell: 'cellA' };
    const beacon = { ...partial, sig: peer.identity.sign(beaconBody(partial)) };
    expect(src.post(community, beacon).ok).toBe(true);

    const restored = new CommunityBoardStore({ now: () => 1000 });
    restored.loadSnapshot(src.toSnapshot());
    expect(restored.beacons(community)).toHaveLength(1);
  });

  it('an undelivered message survives a full server restart (mailbox durability)', async () => {
    const dir = freshDir();
    process.env.KINWEAVE_DATA_DIR = dir;

    const A = new Node();
    const B = new Node();

    // Boot 1: A sends to B while B is offline, then the server goes down.
    server = await startServer(0);
    const url1 = `ws://127.0.0.1:${server.port}/relay`;
    const env = A.seal({ pubKey: B.identity.pubKey, encPubKey: B.enc.pubKey }, 'hangout-secret');
    await sendAndAwaitAccepted(url1, env);
    await server.close(); // flushes the snapshot
    server = undefined;

    // Boot 2: same data dir. B connects for the first time and must still get the mail.
    server = await startServer(0);
    const url2 = `ws://127.0.0.1:${server.port}/relay`;
    const got: string[] = [];
    let resolveDelivered!: () => void;
    const delivered = new Promise<void>((r) => (resolveDelivered = r));
    const conn = await connectRelay(url2, B.identity, (e) => {
      const pt = B.open(e);
      if (pt) {
        got.push(pt);
        resolveDelivered();
      }
    });
    await delivered;
    conn.close();
    expect(got).toContain('hangout-secret');
  }, 20000);
});

/** Open a raw relay socket, send one envelope, and resolve once the relay accepts it. */
function sendAndAwaitAccepted(url: string, env: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'send', env }));
    ws.onmessage = (ev: { data: unknown }) => {
      const data = typeof ev.data === 'string' ? ev.data : String(ev.data);
      let m: { t?: string; reason?: string };
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      if (m.t === 'accepted') {
        ws.close();
        resolve();
      } else if (m.t === 'rejected') {
        ws.close();
        reject(new Error(m.reason ?? 'rejected'));
      }
    };
    ws.onerror = (e: unknown) => reject(e as Error);
  });
}
