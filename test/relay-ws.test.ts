import { describe, it, expect, afterEach } from 'vitest';
import { RelayServer } from '../src/net/relay-server';
import { RelayClient } from '../src/net/relay-client';
import { P2PNode } from '../src/core/node';

describe('WebSocket relay — store-and-forward, challenge auth, tamper rejection', () => {
  let server: RelayServer | undefined;
  const clients: RelayClient[] = [];
  afterEach(async () => {
    for (const c of clients) c.close();
    clients.length = 0;
    await server?.close();
    server = undefined;
  });

  it('delivers offline mail on connect, rejects forgeries, and blocks wrong-key drains', async () => {
    server = new RelayServer();
    const port = await server.start(0);
    const url = `ws://127.0.0.1:${port}`;
    const A = new P2PNode();
    const B = new P2PNode();

    // A sends to B while B is offline.
    const ca = new RelayClient(url);
    clients.push(ca);
    await ca.connect();
    const env = A.seal({ pubKey: B.identity.pubKey, encPubKey: B.enc.pubKey }, 'ws-secret');
    expect((await ca.send(env)).accepted).toBe(true);

    // Tampered ciphertext is rejected (signature no longer matches the body).
    const forged = { ...env, box: { ...env.box, ct: Buffer.from('evil').toString('base64') } };
    expect((await ca.send(forged)).accepted).toBe(false);

    // B connects later, authenticates, and receives the stored mail.
    const cb = new RelayClient(url, B.identity);
    clients.push(cb);
    await cb.connect();
    const got: string[] = [];
    let resolveDelivered!: () => void;
    const delivered = new Promise<void>((r) => (resolveDelivered = r));
    await cb.subscribe(B.id, (d) => {
      const pt = B.open(d.env);
      if (pt) {
        got.push(pt);
        resolveDelivered();
      }
    });
    await delivered;
    expect(got).toContain('ws-secret');

    // A stranger cannot drain B's mailbox: auth fails on fingerprint mismatch.
    const C = new P2PNode();
    const cc = new RelayClient(url, C.identity);
    clients.push(cc);
    await cc.connect();
    let authFailed = false;
    await cc.subscribe(B.id, () => {}).catch(() => {
      authFailed = true;
    });
    expect(authFailed).toBe(true);
  }, 15000);
});
