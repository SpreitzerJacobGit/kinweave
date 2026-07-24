/**
 * Standing intents (spec/10 — ambient matching). The owner declares rolling
 * "I'd say yes to X" envelopes; as OpenCalls arrive on the community intent
 * board, the Persona passively matches them and surfaces a bounded DIGEST of
 * candidates to the owner — rather than a feed to browse or any auto-action.
 *
 * Everything here runs on device against the owner's OWN profile + standing
 * intents. The digest is anti-spiral bounded (spec/07): it caps how many fresh
 * candidates surface at once and takes an `exclude` hook for blocked / cooled-
 * down / already-connected callers. Turning a surfaced candidate into a real
 * hangout still goes through the full gated pairwise negotiation (owner gates
 * G1–G4, disclosure ladder) — a match only SURFACES, it never commits.
 *
 * The book is pure and serializable (toJSON/fromJSON) so any DeviceStore can
 * persist it; no wall-clock is read here (callers pass `now`) so it stays
 * deterministic for the sim and tests.
 */

import type { OpenCall } from './crypto';
import type { PrivateProfile } from '../types/profile';
import { matchCall, type CallMatch } from '../core/call-match';

export interface StandingIntent {
  id: string;
  activityClasses: string[]; // activities this intent is open to (empty = any)
  timeBands: string[]; // bands the owner would say yes to (empty = any)
  geoCells: string[]; // areas (empty = any)
  groupSize: OpenCall['groupSize'] | 'any';
  until: number; // epoch ms — an expired standing intent is inert
}

export interface Candidate {
  call: OpenCall;
  match: CallMatch;
  intentId: string; // which standing intent this call answered
}

export interface DigestOptions {
  now: number;
  /** Anti-spiral: cap how many fresh candidates surface at once (default 5 — the new/day cap). */
  maxCandidates?: number;
  /** Skip a caller (blocked, in cooldown, already connected, or already surfaced). */
  exclude?: (call: OpenCall) => boolean;
}

const BAND_RANK = { high: 2, medium: 1, low: 0 } as const;

/** Does a standing intent's declared scope cover this call? */
export function intentCovers(intent: StandingIntent, call: OpenCall, now: number): boolean {
  if (intent.until <= now) return false;
  if (intent.activityClasses.length && !intent.activityClasses.includes(call.activityClass)) return false;
  if (intent.timeBands.length && !intent.timeBands.includes(call.timeBand)) return false;
  if (intent.geoCells.length && !intent.geoCells.includes(call.geoCell)) return false;
  if (intent.groupSize !== 'any' && call.groupSize !== 'either' && intent.groupSize !== call.groupSize) return false;
  return true;
}

/**
 * Match live board calls against the owner's active standing intents and return a
 * bounded, ranked digest of candidates. A call is a candidate only if some active
 * standing intent covers it AND matchCall (full-profile scoring) returns a match.
 */
export function digestCalls(
  intents: readonly StandingIntent[],
  calls: readonly OpenCall[],
  profile: PrivateProfile,
  opts: DigestOptions,
): Candidate[] {
  const cap = opts.maxCandidates ?? 5;
  const exclude = opts.exclude ?? (() => false);
  const active = intents.filter((i) => i.until > opts.now);

  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const call of calls) {
    if (call.expiry <= opts.now) continue; // self-expired
    if (seen.has(call.pubKey)) continue; // one candidate per caller
    if (exclude(call)) continue;
    const intent = active.find((i) => intentCovers(i, call, opts.now));
    if (!intent) continue;
    const match = matchCall(call, profile);
    if (!match) continue;
    out.push({ call, match, intentId: intent.id });
    seen.add(call.pubKey);
  }

  out.sort((a, b) => {
    const byBand = BAND_RANK[b.match.band] - BAND_RANK[a.match.band];
    if (byBand) return byBand;
    const fit = (m: CallMatch) => (m.scheduleFit ? 1 : 0) + (m.geoFit ? 1 : 0) + (m.groupFit ? 1 : 0);
    return fit(b.match) - fit(a.match);
  });
  return out.slice(0, cap);
}

/** A mutable, serializable collection of the owner's standing intents. */
export class StandingIntentBook {
  private items: StandingIntent[];

  constructor(initial: readonly StandingIntent[] = []) {
    this.items = initial.map((i) => ({ ...i }));
  }

  list(): StandingIntent[] {
    return this.items.map((i) => ({ ...i }));
  }

  /** Add or replace by id. */
  add(intent: StandingIntent): void {
    this.items = this.items.filter((i) => i.id !== intent.id);
    this.items.push({ ...intent });
  }

  remove(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
  }

  active(now: number): StandingIntent[] {
    return this.items.filter((i) => i.until > now);
  }

  /** The bounded, ranked candidate digest for the current board. */
  digest(calls: readonly OpenCall[], profile: PrivateProfile, opts: DigestOptions): Candidate[] {
    return digestCalls(this.items, calls, profile, opts);
  }

  toJSON(): StandingIntent[] {
    return this.list();
  }

  static fromJSON(items: readonly StandingIntent[]): StandingIntentBook {
    return new StandingIntentBook(items);
  }
}
