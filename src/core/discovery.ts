/**
 * Decentralized discovery — local-first, no central matchmaker.
 *
 * A `PresenceBoard` models the shared discovery medium (mDNS / Bluetooth LE /
 * local Wi-Fi broadcast, or a Kademlia DHT). It is NOT a server and NOT trusted:
 * it just carries SIGNED, T0-only presence beacons that anyone can verify. Every
 * reader independently checks the signature; a forged beacon is rejected. See spec/08.
 */

import { verifySig } from './identity';

export interface PresenceBeacon {
  pubKey: string; // signing public key (base64) — the announcer's identity
  encPubKey: string; // encryption public key (base64) — for sealing a first message
  community: string; // T0
  hobbyTags: string[]; // T0
  geoCell: string; // T0, coarse (neighborhood-level, never a coordinate)
  sig: string; // signature over the beacon body by the announcer's signing key
}

/** The signed portion of a beacon (everything except the signature itself). */
export function beaconBody(b: Omit<PresenceBeacon, 'sig'>) {
  return { pubKey: b.pubKey, encPubKey: b.encPubKey, community: b.community, hobbyTags: b.hobbyTags, geoCell: b.geoCell };
}

export class PresenceBoard {
  private beacons: PresenceBeacon[] = [];

  /** Publish a beacon. Rejected unless it is validly self-signed. */
  announce(b: PresenceBeacon): boolean {
    if (!verifySig(b.pubKey, beaconBody(b), b.sig)) return false;
    this.beacons.push(b);
    return true;
  }

  /** Discover peers in a community (optionally filtered by hobby). Each result
   *  is re-verified — the medium is untrusted, so readers never take it on faith. */
  discover(community: string, hobby?: string): PresenceBeacon[] {
    return this.beacons.filter(
      (b) =>
        b.community === community &&
        (!hobby || b.hobbyTags.includes(hobby)) &&
        verifySig(b.pubKey, beaconBody(b), b.sig),
    );
  }
}
