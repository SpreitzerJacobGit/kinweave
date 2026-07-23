/**
 * Account export/import — "your keys are your account."
 *
 * Bundles keys + private profile + consent ledger into one passphrase-sealed
 * blob (scrypt-derived key + AES-256-GCM), portable across devices. The ledger
 * travels so audit history survives a device move. Node crypto for now; the PWA
 * will mirror this with WebCrypto/noble.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { LedgerEvent } from '../types/consent';
import type { PrivateProfile } from '../types/profile';
import type { Attestation } from '../types/attestation';
import type { DeviceStore, KeySeeds } from './types';

export interface AccountBundle {
  v: 1;
  keys: KeySeeds;
  profile: PrivateProfile | null;
  ledger: LedgerEvent[];
  /** Attestation credentials — travel so trust survives a device move (optional). */
  attestations?: Attestation[];
}

/** Read a full account snapshot out of a device store. */
export async function exportAccount(store: DeviceStore): Promise<AccountBundle> {
  const keys = await store.keys.loadKeys();
  if (!keys) throw new Error('no keys to export');
  return {
    v: 1,
    keys,
    profile: await store.profile.loadProfile(),
    ledger: await store.ledger.allEvents(),
    attestations: store.attestations ? await store.attestations.all() : undefined,
  };
}

/** Restore a full account snapshot into a device store. */
export async function importAccount(store: DeviceStore, bundle: AccountBundle): Promise<void> {
  await store.keys.saveKeys(bundle.keys);
  if (bundle.profile) await store.profile.saveProfile(bundle.profile);
  await store.ledger.replaceEvents(bundle.ledger);
  if (bundle.attestations && store.attestations) await store.attestations.replace(bundle.attestations);
}

interface SealedAccount {
  v: 1;
  salt: string;
  iv: string;
  ct: string;
  tag: string;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
}

/** Passphrase-seal a bundle for backup/transfer. */
export function sealBundle(bundle: AccountBundle, passphrase: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(bundle), 'utf8')), cipher.final()]);
  const sealed: SealedAccount = {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
  return Buffer.from(JSON.stringify(sealed), 'utf8').toString('base64');
}

/** Open a passphrase-sealed bundle. Returns null on wrong passphrase / tampering. */
export function openBundle(sealedB64: string, passphrase: string): AccountBundle | null {
  try {
    const sealed = JSON.parse(Buffer.from(sealedB64, 'base64').toString('utf8')) as SealedAccount;
    const key = deriveKey(passphrase, Buffer.from(sealed.salt, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(sealed.ct, 'base64')), decipher.final()]);
    return JSON.parse(pt.toString('utf8')) as AccountBundle;
  } catch {
    return null;
  }
}
