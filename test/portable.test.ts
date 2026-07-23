import { describe, it, expect } from 'vitest';
import { Identity, EncryptionKey, Node, verifySig, signedBody, fingerprint } from '../src/portable/crypto';

describe('portable crypto (browser == node, @noble)', () => {
  it('signs and verifies; tampering and cross-key fail', () => {
    const id = Identity.generate();
    const sig = id.sign({ hello: 'world' });
    expect(verifySig(id.pubKey, { hello: 'world' }, sig)).toBe(true);
    expect(verifySig(id.pubKey, { hello: 'tampered' }, sig)).toBe(false);
    expect(verifySig(Identity.generate().pubKey, { hello: 'world' }, sig)).toBe(false);
  });

  it('key seeds round-trip (survives a device move)', () => {
    const id = Identity.generate();
    const restored = Identity.fromSeed(id.exportSeed());
    expect(restored.pubKey).toBe(id.pubKey);
    expect(verifySig(id.pubKey, { x: 1 }, restored.sign({ x: 1 }))).toBe(true);

    const ek = EncryptionKey.generate();
    const ek2 = EncryptionKey.fromSeed(ek.exportSeed());
    expect(ek2.pubKey).toBe(ek.pubKey);
  });

  it('seals to a peer; only the recipient can open', () => {
    const a = EncryptionKey.generate();
    const b = EncryptionKey.generate();
    const eve = EncryptionKey.generate();
    const box = a.sealTo(b.pubKey, 'meet at the library');
    expect(b.open(a.pubKey, box)).toBe('meet at the library');
    expect(eve.open(a.pubKey, box)).toBeNull();
  });

  it('a node seals an envelope the relay can authenticate but not read', () => {
    const a = new Node();
    const b = new Node();
    const env = a.seal({ pubKey: b.identity.pubKey, encPubKey: b.enc.pubKey }, 'secret-marker');
    // The relay verifies the signature over the ciphertext body.
    expect(verifySig(env.from, signedBody(env), env.sig)).toBe(true);
    // Routing goes to the recipient fingerprint.
    expect(env.to).toBe(fingerprint(b.identity.pubKey));
    // Only b opens it; the envelope carries no plaintext.
    expect(b.open(env)).toBe('secret-marker');
    expect(JSON.stringify(env)).not.toContain('secret-marker');
  });
});
