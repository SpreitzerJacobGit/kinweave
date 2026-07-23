/**
 * Community identity + descriptor (spec/10). A community is nothing but an
 * Ed25519 keypair: its id IS `fingerprint(communityPubKey)`, so it is
 * self-certifying — no server allocates, owns, or registers communities, and
 * names are just display strings (collisions resolved by which QR you scanned).
 *
 * The descriptor is the reusable payload a poster QR encodes (kw1 `kind:'community'`).
 * It carries BOTH transport (relays) AND trust (policy, trustRoots, issuerAllowList)
 * so one scan gives a joiner everything: where to rendezvous and the Sybil bar to
 * clear. It is signed by the community key; verifying binds id↔key↔contents, so a
 * hostile relay cannot weaken a community's policy or forge its identity.
 *
 * The community key ONLY signs this public descriptor. It never decrypts anything
 * and members never hold it — all person-to-person secrecy stays in per-pair
 * sealed boxes. So there is no shared-secret honeypot.
 */

import { Identity, fingerprint, verifySig } from './crypto';
import type { TrustPolicy } from '../types/attestation';
import { OPEN_POLICY } from '../types/attestation';

export interface CommunityIdBlock {
  /** === fingerprint(pubKey). Self-certifying. */
  id: string;
  pubKey: string;
  name: string;
  /** Bumped on rotation; old beacons age out by TTL. */
  epoch: number;
}

export interface CommunityDescriptorV1 {
  v: 1;
  kind: 'community';
  community: CommunityIdBlock;
  /** The Sybil bar a joiner must clear to be connectable. */
  policy: TrustPolicy;
  /** Seed set for the trust graph — the founder/guardian member keys. */
  trustRoots: string[];
  /** Accepted issuer keys for `unique-human` proof-of-personhood tokens. */
  issuerAllowList: string[];
  /** Descriptor content version (bumped on any edit). */
  version: number;
  /** Ordered relay hints where the community board lives. */
  relays: string[];
  /** Expiry (ms epoch); 0 = no expiry. */
  exp: number;
  sig: string;
}

/** The community minter keeps this to re-sign / rotate the descriptor. */
export interface CommunitySecret {
  seed: string;
}

/** Fixed-key signed portion of a descriptor. */
export function communityBody(d: Omit<CommunityDescriptorV1, 'sig'>) {
  return {
    v: d.v,
    kind: d.kind,
    community: { id: d.community.id, pubKey: d.community.pubKey, name: d.community.name, epoch: d.community.epoch },
    policy: d.policy,
    trustRoots: d.trustRoots,
    issuerAllowList: d.issuerAllowList,
    version: d.version,
    relays: d.relays,
    exp: d.exp,
  };
}

export interface MintCommunityInput {
  name: string;
  /** The founder's member signing key — seeded as the first trust root. */
  founder?: string;
  policy?: TrustPolicy;
  trustRoots?: string[];
  issuerAllowList?: string[];
  relays?: string[];
  /** Time-to-live in ms; omit for a non-expiring descriptor. */
  ttlMs?: number;
  /** Absolute current time (ms epoch) if a TTL is given. */
  now?: number;
}

/** Create a brand-new community: a fresh keypair + a signed descriptor. */
export function mintCommunity(input: MintCommunityInput): { descriptor: CommunityDescriptorV1; secret: CommunitySecret } {
  const key = Identity.generate();
  const id = fingerprint(key.pubKey);
  const roots = input.trustRoots ?? (input.founder ? [input.founder] : []);
  const body: Omit<CommunityDescriptorV1, 'sig'> = {
    v: 1,
    kind: 'community',
    community: { id, pubKey: key.pubKey, name: input.name, epoch: 0 },
    policy: input.policy ?? OPEN_POLICY,
    trustRoots: roots,
    issuerAllowList: input.issuerAllowList ?? [],
    version: 1,
    relays: input.relays ?? [],
    exp: input.ttlMs !== undefined && input.now !== undefined ? input.now + input.ttlMs : 0,
  };
  const sig = key.sign(communityBody(body));
  return { descriptor: { ...body, sig }, secret: { seed: key.exportSeed() } };
}

/**
 * Verify a scanned descriptor: id binds to the key, the signature is by that key,
 * and it hasn't expired. This is what stops a poster claiming someone else's
 * community id or tampering with the policy/relays.
 */
export function verifyCommunity(d: CommunityDescriptorV1, now?: number): boolean {
  if (d.v !== 1 || d.kind !== 'community') return false;
  if (d.community.id !== fingerprint(d.community.pubKey)) return false;
  if (d.exp > 0 && now !== undefined && d.exp < now) return false;
  return verifySig(d.community.pubKey, communityBody(d), d.sig);
}

export interface RotateInput {
  policy?: TrustPolicy;
  trustRoots?: string[];
  issuerAllowList?: string[];
  relays?: string[];
  ttlMs?: number;
  now?: number;
}

/** Re-issue a descriptor from the community secret: bump epoch + version, re-sign. */
export function rotateCommunity(prev: CommunityDescriptorV1, secret: CommunitySecret, patch: RotateInput = {}): CommunityDescriptorV1 {
  const key = Identity.fromSeed(secret.seed);
  if (fingerprint(key.pubKey) !== prev.community.id) throw new Error('secret does not match this community');
  const body: Omit<CommunityDescriptorV1, 'sig'> = {
    v: 1,
    kind: 'community',
    community: { ...prev.community, epoch: prev.community.epoch + 1 },
    policy: patch.policy ?? prev.policy,
    trustRoots: patch.trustRoots ?? prev.trustRoots,
    issuerAllowList: patch.issuerAllowList ?? prev.issuerAllowList,
    version: prev.version + 1,
    relays: patch.relays ?? prev.relays,
    exp: patch.ttlMs !== undefined && patch.now !== undefined ? patch.now + patch.ttlMs : prev.exp,
  };
  return { ...body, sig: key.sign(communityBody(body)) };
}
