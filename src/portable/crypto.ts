/**
 * Portable crypto — pure JS (@noble), byte-identical in the browser and Node.
 *
 * This is the crypto the real app + relay share, so a phone's signatures verify
 * on the server by construction (no Web Crypto availability worries, no SPKI
 * format drift). Ed25519 for identity/signing, X25519 + ChaCha20-Poly1305 for
 * sealed peer-to-peer messages. Mirrors src/core/{identity,transport,node}.ts.
 */

import { ed25519, x25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';

export interface SealedBox {
  n: string; // base64 nonce
  ct: string; // base64 ciphertext + tag
}

export interface WireEnvelope {
  to: string; // recipient signing-key fingerprint (routing only)
  from: string; // sender signing public key (base64)
  fromEnc: string; // sender encryption public key (base64)
  box: SealedBox; // encrypted payload — the relay cannot read this
  sig: string; // signature over { to, fromEnc, box } by the sender's signing key
}

function toB64(b: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(b).toString('base64');
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function canon(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

export function fingerprint(pubKeyB64: string): string {
  return 'kw_' + bytesToHex(sha256(new TextEncoder().encode(pubKeyB64))).slice(0, 16);
}

export class Identity {
  readonly pubKey: string;
  readonly id: string;
  private constructor(private readonly priv: Uint8Array) {
    this.pubKey = toB64(ed25519.getPublicKey(priv));
    this.id = fingerprint(this.pubKey);
  }
  static generate(): Identity {
    return new Identity(ed25519.utils.randomPrivateKey());
  }
  static fromSeed(seedB64: string): Identity {
    return new Identity(fromB64(seedB64));
  }
  exportSeed(): string {
    return toB64(this.priv);
  }
  sign(payload: unknown): string {
    return toB64(ed25519.sign(canon(payload), this.priv));
  }
}

export function verifySig(pubKeyB64: string, payload: unknown, sigB64: string): boolean {
  try {
    return ed25519.verify(fromB64(sigB64), canon(payload), fromB64(pubKeyB64));
  } catch {
    return false;
  }
}

export class EncryptionKey {
  readonly pubKey: string;
  private constructor(private readonly priv: Uint8Array) {
    this.pubKey = toB64(x25519.getPublicKey(priv));
  }
  static generate(): EncryptionKey {
    return new EncryptionKey(x25519.utils.randomPrivateKey());
  }
  static fromSeed(seedB64: string): EncryptionKey {
    return new EncryptionKey(fromB64(seedB64));
  }
  exportSeed(): string {
    return toB64(this.priv);
  }
  private key(peerPubB64: string): Uint8Array {
    return sha256(x25519.getSharedSecret(this.priv, fromB64(peerPubB64)));
  }
  sealTo(peerPubB64: string, plaintext: string): SealedBox {
    const nonce = randomBytes(12);
    const ct = chacha20poly1305(this.key(peerPubB64), nonce).encrypt(new TextEncoder().encode(plaintext));
    return { n: toB64(nonce), ct: toB64(ct) };
  }
  open(peerPubB64: string, box: SealedBox): string | null {
    try {
      const pt = chacha20poly1305(this.key(peerPubB64), fromB64(box.n)).decrypt(fromB64(box.ct));
      return new TextDecoder().decode(pt);
    } catch {
      return null;
    }
  }
}

export function signedBody(env: Pick<WireEnvelope, 'to' | 'fromEnc' | 'box'>) {
  return { to: env.to, fromEnc: env.fromEnc, box: env.box };
}

export interface PresenceBeacon {
  pubKey: string;
  encPubKey: string;
  community: string;
  hobbyTags: string[];
  geoCell: string;
  sig: string;
}
export function beaconBody(b: Omit<PresenceBeacon, 'sig'>) {
  return { pubKey: b.pubKey, encPubKey: b.encPubKey, community: b.community, hobbyTags: b.hobbyTags, geoCell: b.geoCell };
}

/** A device node: a signing identity + an encryption key, both persistable. */
export class Node {
  readonly identity: Identity;
  readonly enc: EncryptionKey;
  constructor(seeds?: { idSeed: string; encSeed: string }) {
    this.identity = seeds ? Identity.fromSeed(seeds.idSeed) : Identity.generate();
    this.enc = seeds ? EncryptionKey.fromSeed(seeds.encSeed) : EncryptionKey.generate();
  }
  get id(): string {
    return this.identity.id;
  }
  exportSeeds() {
    return { idSeed: this.identity.exportSeed(), encSeed: this.enc.exportSeed() };
  }
  seal(peer: { pubKey: string; encPubKey: string }, plaintext: string): WireEnvelope {
    const partial = { to: fingerprint(peer.pubKey), fromEnc: this.enc.pubKey, box: this.enc.sealTo(peer.encPubKey, plaintext) };
    return { ...partial, from: this.identity.pubKey, sig: this.identity.sign(partial) };
  }
  open(env: WireEnvelope): string | null {
    return this.enc.open(env.fromEnc, env.box);
  }
  beacon(community: string, hobbyTags: string[], geoCell: string): PresenceBeacon {
    const body = { pubKey: this.identity.pubKey, encPubKey: this.enc.pubKey, community, hobbyTags, geoCell };
    return { ...body, sig: this.identity.sign(beaconBody(body)) };
  }
}
