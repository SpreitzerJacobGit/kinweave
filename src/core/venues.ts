/**
 * Neutral public-venue set. Meetup suggestions are drawn ONLY from this curated
 * public set and are NEVER a function of either party's home coordinate — this
 * defeats home-location triangulation and enforces public-place-first safety.
 * See spec/06-threat-model-and-safety.md §Real-world safety.
 */

import type { ActivityClass } from '../types/vocab';

export interface Venue {
  name: string;
  type: string;
  geoCell: string; // a neutral, community-level cell — not near anyone's home
  isPublic: true;
  staffed: boolean;
  daytime: boolean;
}

/** Keyed by coarse activity class — one per ACTIVITY_CLASS. All public, most staffed + daytime. */
export const NEUTRAL_VENUES: Readonly<Record<ActivityClass, Venue>> = {
  games: { name: 'The Meeple Café', type: 'board-game café', geoCell: 'downtown-commons', isPublic: true, staffed: true, daytime: true },
  food: { name: 'Riverside Market Hall', type: 'public food hall', geoCell: 'downtown-commons', isPublic: true, staffed: true, daytime: true },
  outdoors: { name: 'Cedar Park (main lawn)', type: 'public park', geoCell: 'cedar-park', isPublic: true, staffed: false, daytime: true },
  arts: { name: 'Community Arts Center', type: 'public arts center', geoCell: 'downtown-commons', isPublic: true, staffed: true, daytime: true },
  sport: { name: 'Public Rec Courts', type: 'public courts', geoCell: 'rec-district', isPublic: true, staffed: true, daytime: true },
  learning: { name: 'Central Library — meeting room B', type: 'public library', geoCell: 'downtown-commons', isPublic: true, staffed: true, daytime: true },
};

const FALLBACK: Venue = {
  name: 'Central Library — atrium',
  type: 'public library',
  geoCell: 'downtown-commons',
  isPublic: true,
  staffed: true,
  daytime: true,
};

export function venueFor(activityClass: string): Venue {
  return (NEUTRAL_VENUES as Readonly<Record<string, Venue>>)[activityClass] ?? FALLBACK;
}
