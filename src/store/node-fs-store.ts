/**
 * Filesystem DeviceStore — the self-host + integration-test backend. One JSON
 * file per concern under a data directory. Keys land here as base64 PKCS8 (guard
 * the directory; use `account-export` for passphrase-sealed portability).
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LedgerEvent } from '../types/consent';
import type { PrivateProfile } from '../types/profile';
import type { Attestation } from '../types/attestation';
import type { DeviceStore, KeySeeds } from './types';

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

export class NodeFsDeviceStore implements DeviceStore {
  private readonly keysPath: string;
  private readonly profilePath: string;
  private readonly ledgerPath: string;
  private readonly policyPath: string;
  private readonly attestationsPath: string;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.keysPath = join(dataDir, 'keys.json');
    this.profilePath = join(dataDir, 'profile.json');
    this.ledgerPath = join(dataDir, 'ledger.json');
    this.policyPath = join(dataDir, 'policy.json');
    this.attestationsPath = join(dataDir, 'attestations.json');
  }

  keys = {
    loadKeys: async (): Promise<KeySeeds | null> => readJson<KeySeeds | null>(this.keysPath, null),
    saveKeys: async (s: KeySeeds) => writeJson(this.keysPath, s),
  };

  profile = {
    loadProfile: async (): Promise<PrivateProfile | null> => readJson<PrivateProfile | null>(this.profilePath, null),
    saveProfile: async (p: PrivateProfile) => writeJson(this.profilePath, p),
  };

  ledger = {
    allEvents: async (): Promise<LedgerEvent[]> => readJson<LedgerEvent[]>(this.ledgerPath, []),
    appendEvent: async (e: LedgerEvent) => {
      const events = readJson<LedgerEvent[]>(this.ledgerPath, []);
      events.push(e);
      writeJson(this.ledgerPath, events);
    },
    replaceEvents: async (events: readonly LedgerEvent[]) => writeJson(this.ledgerPath, events),
  };

  policy = {
    isBlocked: async (ownerId: string) => {
      const p = readJson<{ blocks: string[] }>(this.policyPath, { blocks: [] });
      return p.blocks.includes(ownerId);
    },
    block: async (ownerId: string) => {
      const p = readJson<{ blocks: string[]; cooldowns?: Record<string, number> }>(this.policyPath, { blocks: [] });
      if (!p.blocks.includes(ownerId)) p.blocks.push(ownerId);
      writeJson(this.policyPath, p);
    },
    cooldownUntil: async (ownerId: string) => {
      const p = readJson<{ cooldowns?: Record<string, number> }>(this.policyPath, {});
      return p.cooldowns?.[ownerId] ?? null;
    },
    setCooldown: async (ownerId: string, untilMs: number) => {
      const p = readJson<{ blocks: string[]; cooldowns?: Record<string, number> }>(this.policyPath, { blocks: [] });
      p.cooldowns = { ...(p.cooldowns ?? {}), [ownerId]: untilMs };
      writeJson(this.policyPath, p);
    },
  };

  attestations = {
    all: async (): Promise<Attestation[]> => readJson<Attestation[]>(this.attestationsPath, []),
    add: async (a: Attestation) => {
      const list = readJson<Attestation[]>(this.attestationsPath, []);
      list.push(a);
      writeJson(this.attestationsPath, list);
    },
    replace: async (list: readonly Attestation[]) => writeJson(this.attestationsPath, list),
  };
}
