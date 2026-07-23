import { describe, it, expect } from 'vitest';
import { InMemoryRelayHub } from '../src/net/peer-transport';
import { P2PNode } from '../src/core/node';
import { NegotiationDriver } from '../src/core/negotiation-driver';
import { pumpSealed, type SealedSide } from '../src/net/sealed-pump';
import { negotiate } from '../src/core/state-machine';
import { makePair, ava, ben } from '../src/sim/fixtures';
import { approveAll } from '../src/persona/owner';
import { makePairing, encodePairing, decodePairing, verifyPairing } from '../src/net/qr-pairing';

describe('sealed relay hub', () => {
  it('routes ciphertext to the recipient and rejects forgeries — never holds plaintext', () => {
    const hub = new InMemoryRelayHub();
    const a = new P2PNode();
    const b = new P2PNode();
    const env = a.seal({ pubKey: b.identity.pubKey, encPubKey: b.enc.pubKey }, 'secret-marker');
    expect(hub.send(env).accepted).toBe(true);

    let got: string | null = null;
    hub.subscribe(b.id, (d) => {
      got = b.open(d.env);
    });
    expect(got).toBe('secret-marker');
    expect(JSON.stringify(hub.observable())).not.toContain('secret-marker');

    const forged = { ...env, box: { ...env.box, ct: Buffer.from('x').toString('base64') } };
    expect(hub.send(forged).accepted).toBe(false);
  });
});

describe('full negotiation over the sealed transport', () => {
  it('two nodes reach a committed hangout; the relay only ever holds ciphertext', () => {
    const hub = new InMemoryRelayHub();
    const [pa, pb] = makePair(ava, ben, approveAll, approveAll);
    const nodeA = new P2PNode();
    const nodeB = new P2PNode();
    const A: SealedSide = {
      driver: new NegotiationDriver(pa, pb.ownerId, 'initiator'),
      persona: pa,
      node: nodeA,
      peer: { pubKey: nodeB.identity.pubKey, encPubKey: nodeB.enc.pubKey },
    };
    const B: SealedSide = {
      driver: new NegotiationDriver(pb, pa.ownerId, 'responder'),
      persona: pb,
      node: nodeB,
      peer: { pubKey: nodeA.identity.pubKey, encPubKey: nodeA.enc.pubKey },
    };

    const res = pumpSealed(A, B, hub);

    const [ra, rb] = makePair(ava, ben, approveAll, approveAll);
    const ref = negotiate(ra, rb);

    expect(res.a?.outcome).toBe('committed');
    expect(res.b?.outcome).toBe('committed');
    expect(res.a?.artifact?.versionHash).toBe(ref.artifact?.versionHash);
    expect(res.rejected).toBe(0);

    // No Zone-O / disclosed content ever appears in what the relay stored.
    const seen = JSON.stringify(hub.observable());
    expect(seen).not.toContain('"Ava"'); // firstName (T3)
    expect(seen).not.toContain('signal:@ava'); // contact (T4)
    expect(seen).not.toContain('board-games'); // hobby tags (T1)
  });
});

describe('in-person QR pairing', () => {
  it('encodes a signed beacon, verifies on scan, and rejects tampering/expiry', () => {
    const node = new P2PNode();
    const p = makePairing(node, {
      community: 'northside-climbers',
      hobbyTags: ['climbing'],
      geoCell: 'northside',
      rt: 'nonce-1',
      exp: 32503680000000, // far future
    });
    const decoded = decodePairing(encodePairing(p))!;
    expect(decoded.beacon.pubKey).toBe(node.identity.pubKey);
    expect(verifyPairing(decoded)).toBe(true);

    const tampered = { ...decoded, beacon: { ...decoded.beacon, community: 'evil-community' } };
    expect(verifyPairing(tampered)).toBe(false);

    expect(verifyPairing(decoded, decoded.exp + 1)).toBe(false); // expired
  });
});
