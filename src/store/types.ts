/**
 * On-device persistence contracts. Keys, the private profile (Zone O), the
 * append-only consent ledger, and local policy (blocks/cooldowns) all live on
 * the user's device — never on a server. All async so the same shapes back a
 * node-fs store (self-host/tests) and an IndexedDB store (the PWA). See spec/08.
 */

import type { PrivateProfile } from '../types/profile';
import type { LedgerEvent } from '../types/consent';
import type { Attestation } from '../types/attestation';

export interface KeySeeds {
  idSeed: string; // base64 PKCS8 Ed25519 private key
  encSeed: string; // base64 PKCS8 X25519 private key
}

export interface KeyStore {
  loadKeys(): Promise<KeySeeds | null>;
  saveKeys(seeds: KeySeeds): Promise<void>;
}

export interface ProfileStore {
  loadProfile(): Promise<PrivateProfile | null>;
  saveProfile(p: PrivateProfile): Promise<void>;
}

export interface LedgerStore {
  allEvents(): Promise<LedgerEvent[]>;
  appendEvent(e: LedgerEvent): Promise<void>;
  replaceEvents(events: readonly LedgerEvent[]): Promise<void>;
}

export interface PolicyStore {
  isBlocked(ownerId: string): Promise<boolean>;
  block(ownerId: string): Promise<void>;
  cooldownUntil(ownerId: string): Promise<number | null>;
  setCooldown(ownerId: string, untilMs: number): Promise<void>;
}

/** Signed credential atoms (co-presence, vouch, unique-human) held on device (spec/10). */
export interface AttestationStore {
  all(): Promise<Attestation[]>;
  add(a: Attestation): Promise<void>;
  replace(list: readonly Attestation[]): Promise<void>;
}

/** Everything a device persists, bundled. */
export interface DeviceStore {
  keys: KeyStore;
  profile: ProfileStore;
  ledger: LedgerStore;
  policy: PolicyStore;
  /** Optional: attestation credentials. Absent on stores that predate spec/10. */
  attestations?: AttestationStore;
}
