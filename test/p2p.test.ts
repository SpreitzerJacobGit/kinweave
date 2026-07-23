import { describe, it, expect } from 'vitest';
import { Identity, verifySig, fingerprint } from '../src/core/identity';
import { EncryptionKey, Relay, signedBody, type WireEnvelope } from '../src/core/transport';
import { PresenceBoard } from '../src/core/discovery';
import { P2PNode } from '../src/core/node';

/**
 * These prove the "completely peer-to-peer" claim in code: identity is a keypair
 * (no accounts), messages are really signed and E2E-encrypted, and the transport
 * is untrusted infrastructure that can route but cannot read.
 */

describe('P1 — identity is a keypair; signatures are real', () => {
  it('a valid signature verifies and a tampered payload does not', () => {
    const id = new Identity();
    const sig = id.sign({ hello: 'world' });
    expect(verifySig(id.pubKey, { hello: 'world' }, sig)).toBe(true);
    expect(verifySig(id.pubKey, { hello: 'tampered' }, sig)).toBe(false);
  });

  it('a signature from one key does not verify under another', () => {
    const a = new Identity();
    const b = new Identity();
    const sig = a.sign({ x: 1 });
    expect(verifySig(b.pubKey, { x: 1 }, sig)).toBe(false);
  });

  it('the identity id is a stable fingerprint of the public key', () => {
    const id = new Identity();
    expect(id.id).toBe(fingerprint(id.pubKey));
  });
});

describe('P2 — end-to-end encryption: only the recipient can read', () => {
  it('seal/open round-trips between the two parties', () => {
    const alice = new EncryptionKey();
    const bob = new EncryptionKey();
    const box = alice.sealTo(bob.pubKey, 'let us meet at the library');
    expect(bob.open(alice.pubKey, box)).toBe('let us meet at the library');
  });

  it('a third party cannot open the box', () => {
    const alice = new EncryptionKey();
    const bob = new EncryptionKey();
    const eve = new EncryptionKey();
    const box = alice.sealTo(bob.pubKey, 'secret');
    expect(eve.open(alice.pubKey, box)).toBeNull();
  });

  it('ciphertext is not the plaintext', () => {
    const alice = new EncryptionKey();
    const bob = new EncryptionKey();
    const box = alice.sealTo(bob.pubKey, 'plaintext-marker');
    expect(box.ct).not.toContain('plaintext');
    expect(Buffer.from(box.ct, 'base64').toString('utf8')).not.toContain('plaintext-marker');
  });
});

describe('P3 — the relay routes but cannot read, and rejects forgeries', () => {
  it('accepts a validly signed envelope and forwards it to the recipient', () => {
    const a = new P2PNode();
    const b = new P2PNode();
    const relay = new Relay();
    const env = a.seal({ pubKey: b.identity.pubKey, encPubKey: b.enc.pubKey }, 'HELLO from a');
    expect(a.sendVia(relay, env).accepted).toBe(true);
    const inbox = relay.receiveFor(b.id);
    expect(inbox).toHaveLength(1);
    expect(b.open(inbox[0]!)).toBe('HELLO from a');
  });

  it('rejects an envelope whose signature does not match the ciphertext', () => {
    const a = new P2PNode();
    const b = new P2PNode();
    const relay = new Relay();
    const env = a.seal({ pubKey: b.identity.pubKey, encPubKey: b.enc.pubKey }, 'HELLO');
    // Tamper with the ciphertext after signing.
    const forged: WireEnvelope = { ...env, box: { ...env.box, ct: Buffer.from('evil').toString('base64') } };
    expect(relay.send(forged).accepted).toBe(false);
  });

  it('everything the relay can observe is ciphertext — no plaintext ever', () => {
    const a = new P2PNode();
    const b = new P2PNode();
    const relay = new Relay();
    a.sendVia(relay, a.seal({ pubKey: b.identity.pubKey, encPubKey: b.enc.pubKey }, 'meet-at-cedar-park-marker'));
    const seen = JSON.stringify(relay.observable());
    expect(seen).not.toContain('meet-at-cedar-park-marker');
    // The relay holds no private key and has no method to decrypt.
    expect((relay as unknown as Record<string, unknown>).open).toBeUndefined();
    expect((relay as unknown as Record<string, unknown>).decrypt).toBeUndefined();
  });
});

describe('P4 — decentralized discovery: signed beacons, no central authority', () => {
  it('a peer discovers another via a signed presence beacon and re-verifies it', () => {
    const board = new PresenceBoard();
    const a = new P2PNode();
    const b = new P2PNode();
    expect(board.announce(a.beacon('northside-climbers', ['climbing'], 'northside'))).toBe(true);
    expect(board.announce(b.beacon('northside-climbers', ['climbing'], 'northside'))).toBe(true);
    const found = board.discover('northside-climbers', 'climbing');
    expect(found.map((x) => x.pubKey)).toContain(a.identity.pubKey);
  });

  it('a forged beacon (bad signature) is rejected', () => {
    const board = new PresenceBoard();
    const a = new P2PNode();
    const beacon = a.beacon('northside-climbers', ['climbing'], 'northside');
    const forged = { ...beacon, community: 'someone-elses-community' }; // signature no longer matches
    expect(board.announce(forged)).toBe(false);
  });

  it('discovery only returns same-community beacons', () => {
    const board = new PresenceBoard();
    const a = new P2PNode();
    const c = new P2PNode();
    board.announce(a.beacon('northside-climbers', ['climbing'], 'northside'));
    board.announce(c.beacon('downtown-djs', ['dj'], 'downtown'));
    const found = board.discover('northside-climbers');
    expect(found).toHaveLength(1);
    expect(found[0]!.pubKey).toBe(a.identity.pubKey);
  });
});
