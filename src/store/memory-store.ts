/**
 * In-memory DeviceStore — the test double and ephemeral runtime. Mirrors the
 * shape of the fs/IndexedDB stores so code is written once against `DeviceStore`.
 */

import type { LedgerEvent } from '../types/consent';
import type { PrivateProfile } from '../types/profile';
import type { DeviceStore, KeySeeds } from './types';

export class MemoryDeviceStore implements DeviceStore {
  private _keys: KeySeeds | null = null;
  private _profile: PrivateProfile | null = null;
  private _events: LedgerEvent[] = [];
  private _blocks = new Set<string>();
  private _cooldowns = new Map<string, number>();

  keys = {
    loadKeys: async () => this._keys,
    saveKeys: async (s: KeySeeds) => {
      this._keys = s;
    },
  };

  profile = {
    loadProfile: async () => this._profile,
    saveProfile: async (p: PrivateProfile) => {
      this._profile = p;
    },
  };

  ledger = {
    allEvents: async () => this._events.map((e) => ({ ...e })),
    appendEvent: async (e: LedgerEvent) => {
      this._events.push({ ...e });
    },
    replaceEvents: async (events: readonly LedgerEvent[]) => {
      this._events = events.map((e) => ({ ...e }));
    },
  };

  policy = {
    isBlocked: async (ownerId: string) => this._blocks.has(ownerId),
    block: async (ownerId: string) => {
      this._blocks.add(ownerId);
    },
    cooldownUntil: async (ownerId: string) => this._cooldowns.get(ownerId) ?? null,
    setCooldown: async (ownerId: string, untilMs: number) => {
      this._cooldowns.set(ownerId, untilMs);
    },
  };
}
