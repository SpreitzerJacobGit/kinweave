/**
 * Identity — keys, not accounts. A Persona's stable identity IS a self-generated
 * Ed25519 public key. There is no sign-up, no identity provider, no registry.
 * Every message is signed; recipients verify before treating content even as data.
 * Real signatures via Node's built-in crypto — no external dependency. See spec/08.
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

/** Canonical bytes for signing/verifying — stable JSON serialization. */
function canonical(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

/** Short, human-readable fingerprint of a public key (for display/routing). */
export function fingerprint(pubKeyB64: string): string {
  return 'kw_' + createHash('sha256').update(pubKeyB64).digest('hex').slice(0, 16);
}

/** A signing identity. The public key (base64 SPKI DER) is the wire identity. */
export class Identity {
  private readonly priv: KeyObject;
  readonly pubKey: string; // base64 SPKI DER — put on the wire as `fromPersona`
  readonly id: string; // short fingerprint

  /** Generate a fresh identity, or reconstruct one from a persisted private key. */
  constructor(priv?: KeyObject) {
    this.priv = priv ?? generateKeyPairSync('ed25519').privateKey;
    const publicKey = createPublicKey(this.priv);
    this.pubKey = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    this.id = fingerprint(this.pubKey);
  }

  /** Restore an identity from an exported seed (base64 PKCS8 DER private key). */
  static fromSeed(seedB64: string): Identity {
    return new Identity(createPrivateKey({ key: Buffer.from(seedB64, 'base64'), format: 'der', type: 'pkcs8' }));
  }

  /** Export the private key (base64 PKCS8 DER) for on-device persistence. Guard it. */
  exportSeed(): string {
    return (this.priv.export({ type: 'pkcs8', format: 'der' }) as Buffer).toString('base64');
  }

  sign(payload: unknown): string {
    return sign(null, canonical(payload), this.priv).toString('base64');
  }
}

/** Verify a signature against a claimed public key. Returns false on any error. */
export function verifySig(pubKeyB64: string, payload: unknown, sigB64: string): boolean {
  try {
    const pub = createPublicKey({ key: Buffer.from(pubKeyB64, 'base64'), format: 'der', type: 'spki' });
    return verify(null, canonical(payload), pub, Buffer.from(sigB64, 'base64'));
  } catch {
    return false;
  }
}
