/**
 * In-person QR / deep-link pairing. Two phones pair on the spot without any
 * discovery index: one shows a QR encoding a SIGNED, T0-only presence beacon +
 * a rendezvous nonce; the other scans it, verifies the signature (the code is
 * untrusted rendezvous), and can then seal a HELLO directly to the counterpart's
 * keys. Because it's a physical meet, the scanner MAY pre-authorize G1. See spec/08.
 */

import { verifySig } from '../core/identity';
import { beaconBody, type PresenceBeacon } from '../core/discovery';
import type { P2PNode } from '../core/node';

export interface PairingPayloadV1 {
  v: 1;
  beacon: PresenceBeacon; // carries pubKey + encPubKey + T0 (community/hobby/geoCell)
  rt: string; // rendezvous nonce — correlates the scan with the inbound HELLO
  relay?: string; // optional relay hint for delivery
  exp: number; // expiry (ms since epoch)
}

/** Build a pairing payload from a node's signed presence beacon. */
export function makePairing(
  node: P2PNode,
  opts: { community: string; hobbyTags: string[]; geoCell: string; rt: string; exp: number; relay?: string },
): PairingPayloadV1 {
  return {
    v: 1,
    beacon: node.beacon(opts.community, opts.hobbyTags, opts.geoCell),
    rt: opts.rt,
    exp: opts.exp,
    relay: opts.relay,
  };
}

export function encodePairing(p: PairingPayloadV1): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}

export function decodePairing(encoded: string): PairingPayloadV1 | null {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PairingPayloadV1;
  } catch {
    return null;
  }
}

/** The deep link a QR encodes; the PWA also serves an https universal-link fallback. */
export function pairingUri(p: PairingPayloadV1): string {
  return `kinweave://pair#${encodePairing(p)}`;
}
export function pairingUrl(base: string, p: PairingPayloadV1): string {
  return `${base.replace(/\/$/, '')}/pair#${encodePairing(p)}`;
}

/** Verify a scanned pairing: the beacon must be validly self-signed (and unexpired if `now` given). */
export function verifyPairing(p: PairingPayloadV1, now?: number): boolean {
  if (p.v !== 1) return false;
  if (now !== undefined && p.exp < now) return false;
  return verifySig(p.beacon.pubKey, beaconBody(p.beacon), p.beacon.sig);
}
