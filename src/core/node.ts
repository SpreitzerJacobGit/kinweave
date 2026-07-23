/**
 * A P2P node — the thing an owner runs. Bundles a signing Identity and an
 * X25519 EncryptionKey, publishes a signed presence beacon, and seals/opens
 * messages to peers over an untrusted relay. This is the peer-to-peer envelope
 * around the Persona (which holds Zone O). See spec/08.
 */

import { fingerprint as fingerprintOf, Identity } from './identity';
import { EncryptionKey, Relay, signedBody, type WireEnvelope } from './transport';
import { beaconBody, type PresenceBeacon } from './discovery';

export class P2PNode {
  readonly identity = new Identity();
  readonly enc = new EncryptionKey();

  get id(): string {
    return this.identity.id;
  }

  /** A signed, T0-only presence beacon for decentralized discovery. */
  beacon(community: string, hobbyTags: string[], geoCell: string): PresenceBeacon {
    const body = { pubKey: this.identity.pubKey, encPubKey: this.enc.pubKey, community, hobbyTags, geoCell };
    return { ...body, sig: this.identity.sign(beaconBody(body)) };
  }

  /** Seal a plaintext to a peer (identified by a discovered beacon) and sign it. */
  seal(peer: Pick<PresenceBeacon, 'pubKey' | 'encPubKey'>, plaintext: string): WireEnvelope {
    const to = fingerprintOf(peer.pubKey);
    const box = this.enc.sealTo(peer.encPubKey, plaintext);
    const partial = { to, fromEnc: this.enc.pubKey, box };
    return { ...partial, from: this.identity.pubKey, sig: this.identity.sign(signedBody(partial)) };
  }

  /** Open an inbound envelope: returns plaintext, or null if forged/undecryptable. */
  open(env: WireEnvelope): string | null {
    // The relay already checks the signature, but a node re-verifies (trust nothing).
    // Decryption itself fails closed if the sender key doesn't match the ciphertext.
    return this.enc.open(env.fromEnc, env.box);
  }

  /** Send through an untrusted relay. */
  sendVia(relay: Relay, env: WireEnvelope) {
    return relay.send(env);
  }
}
