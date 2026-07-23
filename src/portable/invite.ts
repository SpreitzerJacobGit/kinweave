/**
 * Unified `kw1` invite envelope — the one atom every front door (PWA, agent/MCP,
 * QR) encodes/decodes through, replacing three drifted ad-hoc formats. A single
 * link works everywhere and carries its own `relays[]`, which kills the old
 * "both sides must share a KINWEAVE_RELAY env" coupling.
 *
 * Two kinds share the envelope:
 *  - `invite`    — single-use pairwise (a signed presence beacon + rendezvous
 *                  nonce), the "connect with me" code.
 *  - `community` — the reusable community descriptor (see community.ts), the
 *                  "join this network" poster QR.
 *
 * Ships its own portable base64url (browser `btoa`/`atob` OR Node `Buffer`), since
 * neither of the old encoders was browser+node safe.
 */

import { randomBytes, bytesToHex } from '@noble/hashes/utils';
import { verifySig, beaconBody, type PresenceBeacon, type Node } from './crypto';
import type { CommunityDescriptorV1 } from './community'; // type-only: no runtime cycle

export interface InviteV1 {
  v: 1;
  kind: 'invite';
  beacon: PresenceBeacon; // pubKey + encPubKey + T0 (community/hobby/geoCell)
  rt: string; // rendezvous nonce
  exp: number; // expiry (ms epoch); 0 = no expiry
  relays: string[]; // ordered relay hints
}

export type Kw1 = InviteV1 | CommunityDescriptorV1;

// ---- portable base64url ----------------------------------------------------

function bytesToB64url(b: Uint8Array): string {
  let base64: string;
  if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(b).toString('base64');
  } else {
    let bin = '';
    for (const x of b) bin += String.fromCharCode(x);
    base64 = btoa(bin);
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s: string): Uint8Array {
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'));
  const bin = atob(base64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

/** A fresh rendezvous / anti-replay nonce, browser+node safe. */
export function rid(): string {
  return bytesToHex(randomBytes(8));
}

// ---- codec -----------------------------------------------------------------

export function encodeKw1(x: Kw1): string {
  return bytesToB64url(new TextEncoder().encode(JSON.stringify(x)));
}

export function decodeKw1(s: string): Kw1 | null {
  let obj: unknown;
  try {
    obj = JSON.parse(new TextDecoder().decode(b64urlToBytes(s.trim())));
  } catch {
    return null;
  }
  return normalizeKw1(obj);
}

/** Coerce a parsed object into a Kw1, tolerating legacy `{v,beacon}` invite codes. */
function normalizeKw1(obj: unknown): Kw1 | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (o.kind === 'community') return o as unknown as CommunityDescriptorV1;
  if (o.kind === 'invite' || o.beacon) {
    const beacon = o.beacon as PresenceBeacon | undefined;
    if (!beacon) return null;
    return {
      v: 1,
      kind: 'invite',
      beacon,
      rt: typeof o.rt === 'string' ? o.rt : '',
      exp: typeof o.exp === 'number' ? o.exp : 0,
      relays: Array.isArray(o.relays) ? (o.relays as string[]) : [],
    };
  }
  return null;
}

// ---- invite construction / verification ------------------------------------

export interface MakeInviteInput {
  hobbyTags: string[];
  geoCell: string;
  community?: string;
  relays?: string[];
  rt?: string;
  ttlMs?: number;
  now?: number;
}

/** Build a single-use pairwise invite from a device node. */
export function makeInvite(node: Node, input: MakeInviteInput): InviteV1 {
  const beacon = node.beacon(input.community ?? 'local', input.hobbyTags, input.geoCell);
  return {
    v: 1,
    kind: 'invite',
    beacon,
    rt: input.rt ?? rid(),
    exp: input.ttlMs !== undefined && input.now !== undefined ? input.now + input.ttlMs : 0,
    relays: input.relays ?? [],
  };
}

/** Verify a pairwise invite: the beacon is validly self-signed and unexpired. */
export function verifyInvite(inv: InviteV1, now?: number): boolean {
  if (inv.v !== 1 || inv.kind !== 'invite') return false;
  if (inv.exp > 0 && now !== undefined && inv.exp < now) return false;
  return verifySig(inv.beacon.pubKey, beaconBody(inv.beacon), inv.beacon.sig);
}

// ---- links -----------------------------------------------------------------

/** The QR/deep link the PWA serves: `<base>/#kw1=<payload>`. */
export function inviteUrl(base: string, x: Kw1): string {
  return `${base.replace(/\/$/, '')}/#kw1=${encodeKw1(x)}`;
}

/**
 * Parse a Kw1 out of a URL hash. Accepts the new `#kw1=` and, for backward
 * compatibility, the legacy standard-base64 `#pair=` invite links.
 */
export function parseKw1FromHash(hash: string): Kw1 | null {
  const kw1 = hash.match(/[#&]kw1=([^&]+)/);
  if (kw1) return decodeKw1(kw1[1]!);
  const pair = hash.match(/[#&]pair=([^&]+)/);
  if (pair) {
    // legacy: btoa(JSON.stringify({ v:1, beacon, rt })) — standard base64
    try {
      const json = typeof Buffer !== 'undefined' ? Buffer.from(pair[1]!, 'base64').toString('utf8') : atob(pair[1]!);
      return normalizeKw1(JSON.parse(json));
    } catch {
      return null;
    }
  }
  return null;
}
