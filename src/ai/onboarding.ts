/**
 * Claude-powered onboarding: a chat produces a ProfileDraft (disclosable fields
 * only); Zone-O secrets are entered locally and merged on-device; the interest
 * vector is derived on-device (no LLM). The result is a PrivateProfile that
 * lives only on the user's device. See spec/06 §Onboarding.
 */

import type { PrivateProfile } from '../types/profile';
import { deriveInterestVector } from '../core/compatibility';
import { Tier } from '../types/disclosure';
import type { OwnerPolicy } from '../persona/owner';
import { approveUpToTier } from '../persona/owner';
import type { LLM, LlmMessage } from './llm';
import { ONBOARDING_SYSTEM, EXTRACT_SYSTEM } from './prompts';
import { assertPromptClean } from './scrub';
import type { BoundaryPrefs, ProfileDraft, ProfileSecrets } from './types';
import {
  GROUP_PREFS,
  ENERGY_LEVELS,
  SETTING_PREFS,
  NOVELTY_PREFS,
  filterActivityClasses,
  filterTimeBands,
  oneOf,
} from '../types/vocab';

/** One conversational onboarding turn. `secretValues` are scrubbed from the outbound prompt. */
export async function runOnboardingTurn(llm: LLM, history: LlmMessage[], secretValues: readonly string[] = []): Promise<string> {
  const prompt = ONBOARDING_SYSTEM + '\n' + history.map((m) => `${m.role}: ${m.content}`).join('\n');
  assertPromptClean(prompt, secretValues);
  return llm.complete({ system: ONBOARDING_SYSTEM, messages: history, maxTokens: 1024 });
}

/** Extract a validated ProfileDraft from the conversation. */
export async function extractDraft(llm: LLM, transcript: LlmMessage[], secretValues: readonly string[] = []): Promise<ProfileDraft> {
  const prompt = EXTRACT_SYSTEM + '\n' + transcript.map((m) => m.content).join('\n');
  assertPromptClean(prompt, secretValues);
  const raw = await llm.complete({ system: EXTRACT_SYSTEM, messages: transcript, maxTokens: 1024 });
  return validateDraft(extractJson(raw));
}

/** Merge the LLM draft with locally-entered secrets into a PrivateProfile (Zone O). */
export function assembleProfile(draft: ProfileDraft, secrets: ProfileSecrets): PrivateProfile {
  return {
    ownerId: secrets.ownerId,
    handle: draft.handle,
    community: draft.community,
    hobbyTags: [...draft.hobbyTags],
    geoCell: draft.geoCell,
    homeCoordinate: secrets.homeCoordinate,
    legalName: secrets.legalName,
    interestVector: deriveInterestVector([...draft.hobbyTags, ...draft.valueTags, ...draft.activityClasses]),
    firstName: secrets.firstName,
    valueTags: [...draft.valueTags],
    availabilityMask: draft.availabilityMask,
    groupPref: draft.groupPref,
    activityClasses: [...draft.activityClasses],
    energyLevel: draft.energyLevel,
    timeBands: [...draft.timeBands],
    settingPref: draft.settingPref,
    hardConstraints: [...draft.hardConstraints],
    noveltyPref: draft.noveltyPref,
    contact: secrets.contact,
  };
}

/** Compile boundary preferences into an OwnerPolicy (auto-approve up to a ceiling). */
export function compileOwnerPolicy(prefs: BoundaryPrefs): OwnerPolicy {
  return approveUpToTier(prefs.requireTapPerGate ? Tier.T0 : prefs.autoApproveTierCeiling);
}

// ---------------------------------------------------------------------------

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0 || end < start) throw new Error('no JSON object in LLM output');
  return JSON.parse(text.slice(start, end + 1));
}

const ARR = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const STR = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

/** Validate/coerce an untrusted LLM object into a ProfileDraft (never trust raw output). */
export function validateDraft(obj: unknown): ProfileDraft {
  const o = (obj ?? {}) as Record<string, unknown>;
  const mask = Number.isInteger(o.availabilityMask) ? (o.availabilityMask as number) & 0b1111 : 0;
  const handle = STR(o.handle).trim();
  if (!handle) throw new Error('draft missing handle');
  return {
    handle,
    community: STR(o.community, 'local'),
    hobbyTags: ARR(o.hobbyTags),
    geoCell: STR(o.geoCell, 'unknown'),
    valueTags: ARR(o.valueTags),
    availabilityMask: mask,
    groupPref: oneOf(GROUP_PREFS, o.groupPref, 'either'),
    activityClasses: filterActivityClasses(o.activityClasses),
    energyLevel: oneOf(ENERGY_LEVELS, o.energyLevel, 'medium'),
    timeBands: filterTimeBands(o.timeBands),
    settingPref: oneOf(SETTING_PREFS, o.settingPref, 'public_venue'),
    hardConstraints: ARR(o.hardConstraints),
    noveltyPref: oneOf(NOVELTY_PREFS, o.noveltyPref, 'either'),
  };
}
