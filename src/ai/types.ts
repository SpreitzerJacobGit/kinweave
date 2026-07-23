/**
 * AI DTOs. A ProfileDraft carries ONLY disclosable/coarse fields — Zone-O
 * secrets (legal name, home coordinate, contact) are entered via a plain local
 * form and never pass through the LLM. See spec/06 §Onboarding.
 */

import type { Tier } from '../types/disclosure';

export interface ProfileDraft {
  handle: string;
  community: string;
  hobbyTags: string[];
  geoCell: string;
  valueTags: string[];
  availabilityMask: number;
  groupPref: 'one_on_one' | 'small' | 'either';
  activityClasses: string[];
  energyLevel: 'low' | 'medium' | 'high';
  timeBands: string[];
  settingPref: 'public_venue' | 'outdoor' | 'either';
  hardConstraints: string[];
  noveltyPref: 'familiar' | 'new' | 'either';
}

/** Zone-O secrets collected on-device, never via the LLM. */
export interface ProfileSecrets {
  ownerId: string;
  firstName: string;
  legalName: string;
  homeCoordinate: { lat: number; lng: number };
  contact: string;
}

/** Owner boundary/consent preferences → compiled into an OwnerPolicy. */
export interface BoundaryPrefs {
  autoApproveTierCeiling: Tier; // gates at or below this may auto-approve
  requireTapPerGate: boolean;
  extraNeverShare: string[];
  panicWipe: boolean;
}
