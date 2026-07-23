/**
 * Mock owners/profiles and a factory that pairs two Personas so each knows the
 * other's owner id as its counterpart. Deterministic — no wall-clock, no RNG.
 */

import type { PrivateProfile } from '../types/profile';
import { Persona, type PersonaOptions } from '../persona/persona';
import type { OwnerPolicy } from '../persona/owner';
import { Clock } from '../core/clock';

export function makePair(
  profA: PrivateProfile,
  profB: PrivateProfile,
  policyA: OwnerPolicy,
  policyB: OwnerPolicy,
  optsA: PersonaOptions = {},
  optsB: PersonaOptions = {},
  clock: Clock = new Clock(),
): [Persona, Persona] {
  const a = new Persona(profA, profB.ownerId, policyA, clock, optsA);
  const b = new Persona(profB, profA.ownerId, policyB, clock, optsB);
  return [a, b];
}

/** Ava — a climber/board-gamer, weekends, low-key, public settings. */
export const ava: PrivateProfile = {
  ownerId: 'owner-ava',
  handle: 'ava',
  community: 'northside-climbers',
  hobbyTags: ['climbing', 'board-games', 'coffee'],
  geoCell: 'northside',
  homeCoordinate: { lat: 47.61, lng: -122.33 },
  legalName: 'Ava Lindqvist',
  interestVector: [0.9, 0.8, 0.2, 0.7, 0.1],
  firstName: 'Ava',
  valueTags: ['quiet', 'sober-friendly', 'outdoorsy'],
  availabilityMask: 0b0011,
  groupPref: 'one_on_one',
  activityClasses: ['games', 'outdoors'],
  energyLevel: 'low',
  timeBands: ['weekend_day', 'weekend_eve'],
  settingPref: 'public_venue',
  hardConstraints: ['no_alcohol'],
  noveltyPref: 'either',
  contact: 'signal:@ava',
};

/** Ben — board-gamer/coffee, weekends, low-key, public. Compatible with Ava. */
export const ben: PrivateProfile = {
  ownerId: 'owner-ben',
  handle: 'ben',
  community: 'northside-climbers',
  hobbyTags: ['board-games', 'coffee', 'cycling'],
  geoCell: 'northside',
  homeCoordinate: { lat: 47.62, lng: -122.35 },
  legalName: 'Ben Osei',
  interestVector: [0.85, 0.82, 0.25, 0.6, 0.15],
  firstName: 'Ben',
  valueTags: ['quiet', 'sober-friendly'],
  availabilityMask: 0b0011,
  groupPref: 'one_on_one',
  activityClasses: ['games', 'outdoors'],
  energyLevel: 'low',
  timeBands: ['weekend_day'],
  settingPref: 'public_venue',
  hardConstraints: [],
  noveltyPref: 'new',
  contact: 'signal:@ben',
};

/** Cleo — nightlife/high-energy, weekday evenings, different community. Incompatible. */
export const cleo: PrivateProfile = {
  ownerId: 'owner-cleo',
  handle: 'cleo',
  community: 'northside-climbers',
  hobbyTags: ['nightlife', 'dj', 'karaoke'],
  geoCell: 'downtown',
  homeCoordinate: { lat: 47.6, lng: -122.3 },
  legalName: 'Cleo Marsh',
  interestVector: [0.1, 0.15, 0.95, 0.05, 0.9],
  firstName: 'Cleo',
  valueTags: ['loud', 'party'],
  availabilityMask: 0b1100,
  groupPref: 'small',
  activityClasses: ['nightlife'],
  energyLevel: 'high',
  timeBands: ['weekday_eve'],
  settingPref: 'either',
  hardConstraints: [],
  noveltyPref: 'familiar',
  contact: 'signal:@cleo',
};
