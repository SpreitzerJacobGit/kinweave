/**
 * Optional durability for the store-and-forward relay (server/index.ts).
 *
 * The relay is UNTRUSTED by design and only ever holds signed CIPHERTEXT
 * (point-to-point envelopes) plus PUBLIC signed atoms (T0/T1 presence beacons and
 * open-calls). Snapshotting exactly that state to disk therefore widens nothing
 * the relay didn't already hold in RAM — no plaintext, no private keys — while
 * letting an undelivered hangout message survive a process restart or redeploy
 * instead of being silently dropped when a host spins the instance down.
 *
 * Zero-dependency: one debounced, atomically-written JSON file. Persistence is
 * OFF unless a data dir is configured (KINWEAVE_DATA_DIR), so tests and ephemeral
 * local runs behave exactly as before.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { WireEnvelope } from '../portable/crypto';
import type { IntentBoardSnapshot } from './intent-board';
import type { CommunityBoardSnapshot } from './community-board';

/** One undelivered point-to-point item (recipient fingerprint -> queue). */
export interface StoredMail {
  mailId: string;
  env: WireEnvelope;
}

export interface RelaySnapshot {
  v: 1;
  counter: number;
  mail: [string, StoredMail[]][]; // recipient fingerprint -> queued ciphertext
  intents: IntentBoardSnapshot;
  community: CommunityBoardSnapshot;
}

export interface SnapshotSink {
  readonly enabled: boolean;
  /** Load the last snapshot, or null if none / unreadable. */
  load(): RelaySnapshot | null;
  /** Mark state dirty; the sink persists it on its own (debounced) schedule. */
  save(build: () => RelaySnapshot): void;
  /** Write any pending snapshot synchronously (call on shutdown / SIGTERM). */
  flush(): void;
}

/** No-op sink — persistence disabled (the default). */
export const nullSink: SnapshotSink = {
  enabled: false,
  load: () => null,
  save: () => {},
  flush: () => {},
};

/**
 * Debounced, atomic JSON-file sink. `save()` schedules one trailing write so a
 * burst of messages costs a single disk write; `flush()` forces it out now, which
 * `RunningServer.close()` calls on shutdown so a graceful spin-down loses nothing.
 */
export function fileSink(dir: string, debounceMs = 1000): SnapshotSink {
  const file = join(dir, 'relay.json');
  const tmp = join(dir, 'relay.json.tmp');
  let pending: (() => RelaySnapshot) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const writeNow = () => {
    const build = pending;
    if (!build) return;
    pending = null;
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, JSON.stringify(build()));
    renameSync(tmp, file); // atomic replace — a reader never sees a half-written file
  };

  return {
    enabled: true,
    load() {
      if (!existsSync(file)) return null;
      try {
        const snap = JSON.parse(readFileSync(file, 'utf8')) as RelaySnapshot;
        return snap.v === 1 ? snap : null;
      } catch {
        return null; // a corrupt snapshot must never take the relay down
      }
    },
    save(build) {
      pending = build;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        try {
          writeNow();
        } catch {
          /* best-effort; the next mutation reschedules */
        }
      }, debounceMs);
      // Don't let a pending write keep the process alive; flush() covers shutdown.
      timer.unref?.();
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        writeNow();
      } catch {
        /* best-effort */
      }
    },
  };
}

/** Build a sink from the environment: KINWEAVE_DATA_DIR enables file persistence. */
export function sinkFromEnv(): SnapshotSink {
  const dir = process.env.KINWEAVE_DATA_DIR;
  return dir ? fileSink(dir) : nullSink;
}
