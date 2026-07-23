/**
 * Disclosure tiers and field classification.
 *
 * This is the single source of truth the Disclosure Gate consults to decide
 * whether a given field may leave the owner boundary (Zone O) at the current
 * negotiation tier. See spec/03-disclosure-ladder.md.
 */

export enum Tier {
  /** Public: community membership, hobby tag, coarse geo cell, display handle. */
  T0 = 0,
  /** Compatibility signals: coarse, non-invertible interest/value signals. */
  T1 = 1,
  /** Intent specifics: activity/energy/time-band prefs, hard constraints. */
  T2 = 2,
  /** Plan specifics: venue candidates, real time slots, neighborhood, first name. */
  T3 = 3,
  /** Coordination: exact meeting point, contact channel, precise time. Post-commit only. */
  T4 = 4,
}

/**
 * Fields that may NEVER be disclosed through the protocol, at ANY tier, no
 * matter what the Persona model decides. The Disclosure Gate refuses these
 * unconditionally. This is a structural hard boundary, not a prompt rule.
 */
export const NEVER_DISCLOSE: ReadonlySet<string> = new Set<string>([
  'homeCoordinate',
  'exactLocation',
  'realtimeLocation',
  'legalName',
  'govId',
  'dateOfBirth',
  'financial',
  'interestVector', // raw preference vector — only a quantized, non-invertible derivative may leave
  'personaMemory',
  // special-category data — never disclosed, never inferred
  'health',
  'sexuality',
  'religion',
  'ethnicity',
  'politics',
  'disability',
]);

/**
 * Minimum tier at which each disclosable field may be shared. A field absent
 * from this map is unknown to the protocol and is refused by default (deny-by-default).
 */
export const FIELD_TIER: Readonly<Record<string, Tier>> = {
  // T0 — public
  handle: Tier.T0,
  community: Tier.T0,
  hobbyTags: Tier.T0,
  geoCell: Tier.T0,
  // T1 — coarse compatibility signals (non-invertible)
  interestSignal: Tier.T1,
  valueTags: Tier.T1,
  availabilityMask: Tier.T1,
  groupPref: Tier.T1,
  intentArchetype: Tier.T1, // coarse activity type + time band + energy — the S3 archetype, pre-G2
  // T2 — intent specifics
  activityClass: Tier.T2,
  energyLevel: Tier.T2,
  timeBand: Tier.T2,
  settingPref: Tier.T2,
  hardConstraints: Tier.T2,
  noveltyPref: Tier.T2,
  // T3 — plan specifics
  venueCandidate: Tier.T3,
  timeSlot: Tier.T3,
  neighborhood: Tier.T3,
  firstName: Tier.T3,
  photo: Tier.T3,
  // T4 — coordination (released post-commit only)
  meetingPoint: Tier.T4,
  contact: Tier.T4,
  exactTime: Tier.T4,
};

/** Classify a field key to its minimum tier, or `undefined` if unknown/never. */
export function fieldTier(key: string): Tier | undefined {
  if (NEVER_DISCLOSE.has(key)) return undefined;
  return FIELD_TIER[key];
}

export function tierName(t: Tier): string {
  return `T${t}`;
}
