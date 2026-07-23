/**
 * Client-side OpenCall matching (spec/10 — structured intent coordination).
 *
 * Runs ENTIRELY on device: it scores a discovered OpenCall against the owner's
 * OWN private profile and returns a coarse band + honest frictions. No third
 * party ever computes or sees anything, and — unlike a two-party compatibility
 * probe — this has NO remote-oracle surface: the caller published the call, and
 * we score it locally against our own prefs. (The anti-oracle cap that matters
 * lives downstream, in the negotiation's assessMatch ProbeLimiter, once a match
 * turns into an actual connection.) Reuses the coarse, non-invertible primitives
 * in compatibility.ts.
 */

import { deriveInterestVector, quantize, matchBand, tagOverlap, type MatchBand } from './compatibility';
import type { OpenCall } from '../portable/crypto';
import type { PrivateProfile } from '../types/profile';

export interface CallMatch {
  band: MatchBand;
  scheduleFit: boolean; // the call's time band is one the owner keeps free
  geoFit: boolean; // same neighborhood cell
  groupFit: boolean; // the call's group size is compatible with the owner's preference
  sharedActivities: string[]; // activity classes / hobbies in common
  reasons: string[]; // honest, human-readable rationale (incl. frictions)
}

const ORDER: Record<MatchBand, number> = { low: 0, medium: 1, high: 2 };
function strongest(a: MatchBand, b: MatchBand): MatchBand {
  return ORDER[a] >= ORDER[b] ? a : b;
}

function groupCompatible(pref: PrivateProfile['groupPref'], size: OpenCall['groupSize']): boolean {
  return pref === 'either' || size === 'either' || pref === size;
}

/**
 * Score a discovered call against the owner's profile. Returns null when there is
 * nothing in common at all (no shared activity, wrong time band, different area)
 * — not worth surfacing to the owner.
 */
export function matchCall(call: OpenCall, profile: PrivateProfile): CallMatch | null {
  const myTags = [...new Set([...profile.activityClasses, ...profile.hobbyTags])];
  const sharedActivities = tagOverlap([call.activityClass], myTags);
  const scheduleFit = profile.timeBands.includes(call.timeBand);
  const geoFit = call.geoCell === profile.geoCell;
  const groupFit = groupCompatible(profile.groupPref, call.groupSize);

  // Nothing in common — filter it out.
  if (sharedActivities.length === 0 && !scheduleFit && !geoFit) return null;

  // Interest axis — reuse the coarse, non-invertible compatibility primitives.
  const mine = quantize(deriveInterestVector(myTags));
  const theirs = quantize(deriveInterestVector([call.activityClass]));
  const interestBand = matchBand(mine, theirs, sharedActivities.length);

  // Concrete coarse-fit axis (the honest, interpretable signal for a hangout).
  const fitScore = (sharedActivities.length ? 2 : 0) + (scheduleFit ? 1 : 0) + (geoFit ? 1 : 0) + (groupFit ? 1 : 0);
  const fitBand: MatchBand = fitScore >= 4 ? 'high' : fitScore >= 2 ? 'medium' : 'low';

  const band = strongest(interestBand, fitBand);

  const reasons: string[] = [];
  if (sharedActivities.length) reasons.push(`shares ${sharedActivities.join(', ')}`);
  reasons.push(scheduleFit ? `free ${call.timeBand}` : `busy on ${call.timeBand}`);
  reasons.push(geoFit ? `same area (${call.geoCell})` : `different area (${call.geoCell})`);
  if (!groupFit) reasons.push(`group size ${call.groupSize} vs prefers ${profile.groupPref}`);

  return { band, scheduleFit, geoFit, groupFit, sharedActivities, reasons };
}
