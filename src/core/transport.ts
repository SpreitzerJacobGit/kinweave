/**
 * Transport (Zone T) — untrusted, interchangeable infrastructure.
 *
 * A `Relay` routes messages between peers WITHOUT being able to read them:
 * payloads are end-to-end encrypted with X25519 key agreement + AES-256-GCM
 * (real crypto, Node built-in, no deps). The relay verifies the sender's
 * SIGNATURE over the ciphertext (authenticity) but has no private key, so it
 * cannot decrypt (confidentiality). Relays are dumb, many, self-hostable, and
 * trusted with nothing. See spec/08.
 */

import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { verifySig } from './identity';

export interface SealedBox {
  iv: string; // base64
  ct: string; // base64 ciphertext
  tag: string; // base64 GCM auth tag
}

/** An X25519 encryption identity, separate from the Ed25519 signing identity. */
export class EncryptionKey {
  private readonly priv: KeyObject;
  readonly pubKey: string; // base64 SPKI DER

  /** Generate a fresh encryption key, or reconstruct one from a persisted private key. */
  constructor(priv?: KeyObject) {
    this.priv = priv ?? generateKeyPairSync('x25519').privateKey;
    const publicKey = createPublicKey(this.priv);
    this.pubKey = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  }

  /** Restore from an exported seed (base64 PKCS8 DER private key). */
  static fromSeed(seedB64: string): EncryptionKey {
    return new EncryptionKey(createPrivateKey({ key: Buffer.from(seedB64, 'base64'), format: 'der', type: 'pkcs8' }));
  }

  /** Export the private key (base64 PKCS8 DER) for on-device persistence. Guard it. */
  exportSeed(): string {
    return (this.priv.export({ type: 'pkcs8', format: 'der' }) as Buffer).toString('base64');
  }

  private sharedKey(peerPubB64: string): Buffer {
    const peer = createPublicKey({ key: Buffer.from(peerPubB64, 'base64'), format: 'der', type: 'spki' });
    const secret = diffieHellman({ privateKey: this.priv, publicKey: peer });
    return createHash('sha256').update(secret).digest(); // 32-byte AES key
  }

  sealTo(recipientPubB64: string, plaintext: string): SealedBox {
    const key = this.sharedKey(recipientPubB64);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
    return { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  }

  open(senderPubB64: string, box: SealedBox): string | null {
    try {
      const key = this.sharedKey(senderPubB64);
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
      const pt = Buffer.concat([decipher.update(Buffer.from(box.ct, 'base64')), decipher.final()]);
      return pt.toString('utf8');
    } catch {
      return null; // wrong key or tampered ciphertext
    }
  }
}

/** What travels over the relay. The relay sees only routing metadata + ciphertext. */
export interface WireEnvelope {
  to: string; // recipient signing-key fingerprint (routing only)
  from: string; // sender signing public key (base64)
  fromEnc: string; // sender encryption public key (base64)
  box: SealedBox; // encrypted payload — the relay cannot read this
  sig: string; // signature over { to, fromEnc, box } by the sender's signing key
}

export function signedBody(env: Pick<WireEnvelope, 'to' | 'fromEnc' | 'box'>) {
  return { to: env.to, fromEnc: env.fromEnc, box: env.box };
}

/** An untrusted relay. Verifies authenticity; cannot read content; holds no keys. */
export class Relay {
  private queue: WireEnvelope[] = [];

  /** Accept a message iff its signature over the (encrypted) body is valid. */
  send(env: WireEnvelope): { accepted: boolean; reason?: string } {
    if (!verifySig(env.from, signedBody(env), env.sig)) {
      return { accepted: false, reason: 'bad-signature' };
    }
    this.queue.push(env);
    return { accepted: true };
  }

  /** Store-and-forward: pull messages addressed to a recipient fingerprint. */
  receiveFor(toFingerprint: string): WireEnvelope[] {
    return this.queue.filter((e) => e.to === toFingerprint);
  }

  /** Everything the relay can observe — proof it never holds plaintext. */
  observable(): WireEnvelope[] {
    return this.queue;
  }
}
