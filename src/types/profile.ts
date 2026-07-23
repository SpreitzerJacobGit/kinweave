/**
 * The private profile — Zone O. This lives inside the owner boundary and is
 * held as a private field on the Persona. Nothing here leaves in raw form; only
 * derived/coarse/consented projections may be emitted, and only via the Gate.
 */
export interface PrivateProfile {
  ownerId: string;
  // T0 — public
  handle: string;
  community: string;
  hobbyTags: string[];
  geoCell: string; // coarse (neighborhood-level), never a coordinate

  // Zone O secrets — NEVER disclosed raw through the protocol
  homeCoordinate: { lat: number; lng: number };
  legalName: string;
  interestVector: number[]; // raw preference vector — only a quantized derivative leaves

  // Disclosable specifics (gated by tier)
  firstName: string; // T3
  valueTags: string[]; // T1
  availabilityMask: number; // T1 (coarse); exact times are T4
  groupPref: 'one_on_one' | 'small' | 'either'; // T1
  activityClasses: string[]; // coarse -> T1 archetype; specific -> T2
  energyLevel: 'low' | 'medium' | 'high'; // T2
  timeBands: string[]; // T2 (weekday_day | weekday_eve | weekend_day | weekend_eve)
  settingPref: 'public_venue' | 'outdoor' | 'either'; // T2
  hardConstraints: string[]; // T2
  noveltyPref: 'familiar' | 'new' | 'either'; // T2
  contact: string; // T4 only, released post-commit
}
