/**
 * Shared, PURE negotiation logic used by BOTH drivers:
 *  - `state-machine.ts` `negotiate()` — the synchronous reference/simulation.
 *  - `negotiation-driver.ts` — the event-driven, per-node, networked driver.
 *
 * Keeping the guards + artifact assembly here is what stops the two drivers
 * from drifting. Nothing here touches Zone O directly or performs I/O.
 */

import type { AbandonCode, Message, Stage } from '../types/envelope';
import type { ProposedHangout } from '../types/artifact';

export interface Caps {
  probe: number;
  align: number;
  coplan: number;
  owner: number;
  messageBudget: number;
}

export const DEFAULT_CAPS: Caps = { probe: 2, align: 3, coplan: 4, owner: 2, messageBudget: 40 };

export interface Rounds {
  probe: number;
  align: number;
  coplan: number;
  owner: number;
}

/** Idempotent two-phase commit book, keyed on artifact hash. */
export class CommitBook {
  private done = new Set<string>();
  confirm(hash: string): 'committed' | 'duplicate' {
    if (this.done.has(hash)) return 'duplicate';
    this.done.add(hash);
    return 'committed';
  }
  size(): number {
    return this.done.size;
  }
}

/** Generic face-saving reasons sent to the counterpart; true reason stays owner-side. */
export const FACE_SAVING: Record<AbandonCode, string> = {
  declined: 'Not available to connect right now.',
  timeout: "Couldn't connect in time.",
  low_match: 'No strong match right now.',
  archetype_mismatch: "Doesn't look like a fit right now.",
  disclosure_refused: "Can't share enough to plan this right now.",
  no_feasible_plan: "Couldn't find a time that works right now.",
  owner_declined: "Can't make this one work.",
  owner_timeout: "Couldn't confirm in time.",
  commit_failed: "Couldn't finalize this one.",
  budget_exhausted: "Let's try again another time.",
  policy_unmet: "Not connectable in this community yet.",
};

export function intersect(a: string[], b: string[]): string[] {
  const bs = new Set(b);
  return a.filter((x) => bs.has(x));
}

/** Merge the fields a given persona disclosed on a transcript (public-to-both). */
export function collectDisclosed(transcript: readonly Message[], fromHandle: string): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const m of transcript) {
    if (m.env.fromPersona !== fromHandle) continue;
    if (m.type === 'SIGNAL' || m.type === 'DISCLOSE' || m.type === 'INTENT_FRAME') {
      Object.assign(merged, m.payload);
    }
  }
  return merged;
}

/** Deterministic string hash (djb2) — no crypto/time; both nodes agree on it. */
export function hashPlan(input: unknown): string {
  const s = JSON.stringify(input);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `v${h.toString(16)}`;
}

export interface BuildArtifactParams {
  proposal: Message;
  selfHandle: string;
  selfOwnerId: string;
  counterpartHandle: string;
  counterpartOwnerId: string;
  selfRevealedKeys: string[];
  counterpartRevealedKeys: string[];
  transcript: readonly Message[];
  stages: Stage[];
  rounds: Rounds;
  transcriptRef: string;
  band: 'low' | 'medium' | 'high';
}

/**
 * Assemble the ProposedHangout STRICTLY from what was disclosed on the transcript.
 * Works per-node: "self" vs "counterpart" is relative to the caller, but the
 * `versionHash` (which hashes only the symmetric `plan`) is identical on both
 * sides, so a G4 approval binds the same commitment for both owners.
 */
export function buildArtifact(p: BuildArtifactParams): ProposedHangout {
  const dSelf = collectDisclosed(p.transcript, p.selfHandle);
  const dOther = collectDisclosed(p.transcript, p.counterpartHandle);
  const venue = p.proposal.payload.venueCandidate as { name?: string; type?: string; geoCell?: string; isPublic?: boolean } | undefined;
  const slot = p.proposal.payload.timeSlot as { date: string; start: string; end: string; timezone: string };

  const hobbySelf = (dSelf.hobbyTags as string[]) ?? [];
  const hobbyOther = (dOther.hobbyTags as string[]) ?? [];
  const sharedHobbies = hobbySelf.filter((t) => new Set(hobbyOther).has(t));
  const valSelf = (dSelf.valueTags as string[]) ?? [];
  const valOther = (dOther.valueTags as string[]) ?? [];
  const sharedValues = valSelf.filter((t) => new Set(valOther).has(t));
  const energySelf = dSelf.energyLevel as string | undefined;
  const energyOther = dOther.energyLevel as string | undefined;

  const conflicts: string[] = [];
  if (energySelf && energyOther && energySelf !== energyOther) {
    conflicts.push(`energy mismatch: ${energySelf} vs ${energyOther}`);
  }

  const overall = p.band === 'high' ? 0.8 : p.band === 'medium' ? 0.6 : 0.4;
  const label = overall >= 0.75 ? 'high' : overall >= 0.5 ? 'moderate' : 'low';

  const caveats = ['First meetup — limited shared history; confidence is provisional.'];
  if (conflicts.length) caveats.push('There is at least one value/energy conflict — see axes.');

  const plan = {
    activity: {
      class: (p.proposal.text ?? '').includes('games') ? 'games' : (sharedHobbies[0] ?? 'shared activity'),
      specific: p.proposal.text ?? 'a shared activity',
      whyThis: sharedHobbies.length ? `Both list: ${sharedHobbies.join(', ')}.` : 'Overlapping archetype.',
    },
    place: {
      type: venue?.type ?? 'public venue',
      name: venue?.name,
      geoCell: venue?.geoCell ?? 'downtown-commons',
      isPublic: venue?.isPublic === true,
      accessibilityNotes: 'Public, daytime, staffed where possible.',
    },
    time: slot,
    estCostBand: 'low' as const,
    logisticsNotes: ['Public place, daytime first meetup.'],
  };

  return {
    artifactId: `hangout-${[p.selfOwnerId, p.counterpartOwnerId].sort().join('-')}`,
    versionHash: hashPlan(plan),
    status: 'pending_review',
    plan,
    compatibilityRationale: {
      overallConfidence: overall,
      label,
      axes: {
        interestOverlap: { score: Math.min(1, sharedHobbies.length * 0.34), evidence: sharedHobbies, conflicts: [] },
        valueAlignment: { score: Math.min(1, sharedValues.length * 0.34), evidence: sharedValues, conflicts },
        scheduleFit: { score: 0.7, evidence: [slot?.date ?? 'agreed slot'] },
        geoConvenience: { score: 0.7, evidence: [venue?.geoCell ?? 'neutral cell'] },
      },
      honestCaveats: caveats,
      noveltyFlag: sharedHobbies.length <= 1,
    },
    disclosureLedger: {
      myRevealed: p.selfRevealedKeys,
      theirRevealed: p.counterpartRevealedKeys,
      stillPrivate: ['homeCoordinate', 'legalName', 'interestVector', 'personaMemory'],
    },
    provenance: {
      stagesTraversed: [...p.stages],
      roundsUsed: { ...p.rounds },
      transcriptRef: p.transcriptRef,
    },
  };
}
