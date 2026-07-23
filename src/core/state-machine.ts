/**
 * The negotiation state machine — drives two Personas through S0..S8.
 *
 * The orchestrator NEVER reads a Persona's private profile (Zone O). It moves
 * messages over the Channel, invokes owner gates, and assembles the output
 * artifact strictly from what was DISCLOSED on the channel. See spec/01-state-machine.md.
 */

import { Channel } from './channel';
import { Tier } from '../types/disclosure';
import type { AbandonCode, Message, Stage } from '../types/envelope';
import type { ProposedHangout } from '../types/artifact';
import type { Persona } from '../persona/persona';

export interface Caps {
  probe: number;
  align: number;
  coplan: number;
  owner: number;
  messageBudget: number;
}

export const DEFAULT_CAPS: Caps = { probe: 2, align: 3, coplan: 4, owner: 2, messageBudget: 40 };

export interface NegotiationResult {
  outcome: 'committed' | 'abandoned';
  code?: AbandonCode;
  publicReason?: string; // face-saving reason sent to the counterpart
  trueReason?: string; // real reason — stays owner-side
  artifact?: ProposedHangout;
  stagesTraversed: Stage[];
  rounds: { probe: number; align: number; coplan: number; owner: number };
  channel: Channel;
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

const FACE_SAVING: Record<AbandonCode, string> = {
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
};

export function negotiate(a: Persona, b: Persona, caps: Caps = DEFAULT_CAPS, channelId = 'ch-1'): NegotiationResult {
  const channel = new Channel(channelId);
  const stages: Stage[] = [];
  const rounds = { probe: 0, align: 0, coplan: 0, owner: 0 };
  let budget = caps.messageBudget;

  const post = (m: Message): Message => {
    budget -= 1;
    return channel.post(m);
  };
  const overBudget = () => budget < 0;

  const abandon = (code: AbandonCode, trueReason: string): NegotiationResult => {
    const publicReason = FACE_SAVING[code];
    post(a.abandon(code, publicReason));
    return { outcome: 'abandoned', code, publicReason, trueReason, stagesTraversed: stages, rounds, channel };
  };

  // ---- S0 DISCOVERY ----------------------------------------------------------
  stages.push('S0');
  const cardA = a.publicCard();
  const cardB = b.publicCard();
  if (cardA.community !== cardB.community) {
    return abandon('low_match', 'different communities');
  }

  // ---- S1 HANDSHAKE (Gate G1: connection approval, each owner) ----------------
  stages.push('S1');
  const hello = post(a.hello(b.ownerId));
  b.ingestInbound(hello);
  const ack = post(b.helloAck(hello.env.msgId));
  a.ingestInbound(ack);
  const g1a = a.requestConsent({ gate: 'G1', counterpart: b.ownerId });
  const g1b = b.requestConsent({ gate: 'G1', counterpart: a.ownerId });
  if (g1a.decision.defer || g1b.decision.defer) return abandon('timeout', 'G1 not answered');
  if (!g1a.decision.approve || !g1b.decision.approve) return abandon('declined', 'connection declined by an owner');

  // ---- S2 MATCH_PROBE (autonomous; coarse machine-signals) -------------------
  stages.push('S2');
  const sigA = post(a.signalMessage());
  const sigB = post(b.signalMessage());
  b.ingestInbound(sigA);
  a.ingestInbound(sigB);
  rounds.probe += 1;
  const mA = a.assessMatch(sigB.payload);
  const mB = b.assessMatch(sigA.payload);
  if (mA.capped || mB.capped) return abandon('low_match', 'probe cap reached');
  if (mA.band === 'low' || mB.band === 'low') return abandon('low_match', 'coarse match below floor');

  // ---- S3 INTENT_ALIGN (Gate G2: consent to begin T2 sharing) ----------------
  stages.push('S3');
  const ifA = post(a.intentFrame());
  const ifB = post(b.intentFrame());
  b.ingestInbound(ifA);
  a.ingestInbound(ifB);
  rounds.align += 1;
  const arA = a.archetype();
  const arB = b.archetype();
  const sharedActivities = intersect(arA.activityClasses, arB.activityClasses);
  const sharedTimeBands = intersect(arA.timeBands, arB.timeBands);
  if (sharedActivities.length === 0 || sharedTimeBands.length === 0) {
    return abandon('archetype_mismatch', 'no shared activity or time band');
  }
  const g2a = a.requestConsent({ gate: 'G2', counterpart: b.ownerId, tierTo: Tier.T2 });
  const g2b = b.requestConsent({ gate: 'G2', counterpart: a.ownerId, tierTo: Tier.T2 });
  if (g2a.decision.defer || g2b.decision.defer) return abandon('owner_timeout', 'G2 not answered');
  if (!g2a.decision.approve || !g2b.decision.approve) return abandon('disclosure_refused', 'G2 disclosure consent denied');

  // ---- S4 DISCLOSE_LADDER (lockstep T2 then T3; Gate G3 per tier) -------------
  stages.push('S4');
  let t3GrantA = '';
  let t3GrantB = '';
  for (const tier of [Tier.T2, Tier.T3] as const) {
    const fieldsHint = tier === Tier.T2 ? ['activityClass', 'hardConstraints', 'noveltyPref'] : ['firstName', 'neighborhood'];
    const ga = a.requestConsent({ gate: 'G3', counterpart: b.ownerId, tierTo: tier, fields: fieldsHint });
    if (ga.decision.defer) return abandon('owner_timeout', `G3 T${tier} not answered`);
    if (!ga.decision.approve) return abandon('disclosure_refused', `G3 T${tier} denied`);
    const dA = post(a.discloseTier(tier, ga.grantId!));
    b.ingestInbound(dA);

    const gb = b.requestConsent({ gate: 'G3', counterpart: a.ownerId, tierTo: tier, fields: fieldsHint });
    if (gb.decision.defer) return abandon('owner_timeout', `G3 T${tier} not answered`);
    if (!gb.decision.approve) return abandon('disclosure_refused', `G3 T${tier} denied`);
    const dB = post(b.discloseTier(tier, gb.grantId!));
    a.ingestInbound(dB);

    if (tier === Tier.T3) {
      t3GrantA = ga.grantId!;
      t3GrantB = gb.grantId!;
    }
    if (overBudget()) return abandon('budget_exhausted', 'message budget exhausted in disclosure');
  }

  // ---- S5 COPLAN (symmetric propose/review loop, capped) ---------------------
  stages.push('S5');
  let proposer = a;
  let reviewer = b;
  let proposerGrant = t3GrantA;
  let accepted: Message | null = null;
  for (let round = 0; round < caps.coplan; round++) {
    const prop = post(proposer.proposePlan(sharedActivities, sharedTimeBands, proposerGrant, round));
    reviewer.ingestInbound(prop);
    rounds.coplan += 1;
    const rev = post(reviewer.reviewPlan(prop, sharedActivities));
    proposer.ingestInbound(rev);
    if (overBudget()) return abandon('budget_exhausted', 'message budget exhausted in coplan');
    if (rev.payload.decision === 'accept') {
      accepted = prop;
      break;
    }
    // counter -> swap roles for the next round
    [proposer, reviewer] = [reviewer, proposer];
    proposerGrant = proposer === a ? t3GrantA : t3GrantB;
  }
  if (!accepted) return abandon('no_feasible_plan', 'coplan cap reached without acceptance');

  // ---- S6 OWNER_REVIEW (Gate G4: the hard commitment gate, both owners) ------
  stages.push('S6');
  const artifact = buildArtifact(accepted, a, b, stages, rounds, channel, mA.band ?? 'medium');
  rounds.owner += 1;
  const g4a = a.requestConsent({ gate: 'G4', counterpart: b.ownerId, artifact });
  const g4b = b.requestConsent({ gate: 'G4', counterpart: a.ownerId, artifact });
  if (g4a.decision.defer || g4b.decision.defer) return abandon('owner_timeout', 'G4 not answered');
  if (!g4a.decision.approve || !g4b.decision.approve) {
    artifact.status = 'declined';
    return abandon('owner_declined', 'an owner declined the proposed hangout');
  }
  artifact.status = 'approved';

  // ---- S7 COMMIT (T4 release + idempotent two-phase commit) ------------------
  stages.push('S7');
  const t4a = a.requestConsent({ gate: 'G3', counterpart: b.ownerId, tierTo: Tier.T4, fields: ['contact'] });
  const t4b = b.requestConsent({ gate: 'G3', counterpart: a.ownerId, tierTo: Tier.T4, fields: ['contact'] });
  if (!t4a.decision.approve || !t4b.decision.approve) return abandon('disclosure_refused', 'T4 coordination release denied');

  const hash = artifact.versionHash;
  const ciA = post(a.commitIntent(hash, g4a.grantId!));
  b.ingestInbound(ciA);
  const ciB = post(b.commitIntent(hash, g4b.grantId!));
  a.ingestInbound(ciB);
  const ccA = a.commitConfirm(hash, t4a.grantId!);
  const ccB = b.commitConfirm(hash, t4b.grantId!);
  if (!ccA || !ccB) return abandon('commit_failed', 'a party failed to confirm');

  const book = new CommitBook();
  book.confirm(hash); // first confirm binds
  book.confirm(hash); // second confirm is an idempotent duplicate (no double-booking)
  post(ccA);
  post(ccB);
  b.ingestInbound(ccA);
  a.ingestInbound(ccB);

  // ---- S8 CLOSED -------------------------------------------------------------
  stages.push('S8');
  artifact.status = 'committed';
  return { outcome: 'committed', artifact, stagesTraversed: stages, rounds, channel };
}

// ---------------------------------------------------------------------------

function intersect(a: string[], b: string[]): string[] {
  const bs = new Set(b);
  return a.filter((x) => bs.has(x));
}

/** Merge the fields a given persona disclosed on the channel (public-to-both). */
function collectDisclosed(channel: Channel, fromHandle: string): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const m of channel.transcript()) {
    if (m.env.fromPersona !== fromHandle) continue;
    if (m.type === 'SIGNAL' || m.type === 'DISCLOSE' || m.type === 'INTENT_FRAME') {
      Object.assign(merged, m.payload);
    }
  }
  return merged;
}

/** Simple deterministic string hash (djb2) — no crypto/time needed for the sim. */
function hashPlan(input: unknown): string {
  const s = JSON.stringify(input);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `v${h.toString(16)}`;
}

function buildArtifact(
  proposal: Message,
  a: Persona,
  b: Persona,
  stages: Stage[],
  rounds: { probe: number; align: number; coplan: number; owner: number },
  channel: Channel,
  band: 'low' | 'medium' | 'high',
): ProposedHangout {
  const dA = collectDisclosed(channel, a.handle);
  const dB = collectDisclosed(channel, b.handle);
  const venue = proposal.payload.venueCandidate as { name?: string; type?: string; geoCell?: string; isPublic?: boolean };
  const slot = proposal.payload.timeSlot as { date: string; start: string; end: string; timezone: string };

  const hobbyA = (dA.hobbyTags as string[]) ?? [];
  const hobbyB = (dB.hobbyTags as string[]) ?? [];
  const sharedHobbies = hobbyA.filter((t) => new Set(hobbyB).has(t));
  const valA = (dA.valueTags as string[]) ?? [];
  const valB = (dB.valueTags as string[]) ?? [];
  const sharedValues = valA.filter((t) => new Set(valB).has(t));
  const energyA = dA.energyLevel as string | undefined;
  const energyB = dB.energyLevel as string | undefined;

  const conflicts: string[] = [];
  if (energyA && energyB && energyA !== energyB) {
    conflicts.push(`energy mismatch: ${a.handle}=${energyA}, ${b.handle}=${energyB}`);
  }

  const overall = band === 'high' ? 0.8 : band === 'medium' ? 0.6 : 0.4;
  const label = overall >= 0.75 ? 'high' : overall >= 0.5 ? 'moderate' : 'low';

  const caveats = ['First meetup — limited shared history; confidence is provisional.'];
  if (conflicts.length) caveats.push('There is at least one value/energy conflict — see axes.');

  const plan = {
    activity: {
      class: (proposal.text ?? '').includes('games') ? 'games' : (sharedHobbies[0] ?? 'shared activity'),
      specific: proposal.text ?? 'a shared activity',
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
    artifactId: `hangout-${a.ownerId}-${b.ownerId}`,
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
      myRevealed: a.revealedKeys(),
      theirRevealed: b.revealedKeys(),
      stillPrivate: ['homeCoordinate', 'legalName', 'interestVector', 'personaMemory'],
    },
    provenance: {
      stagesTraversed: [...stages],
      roundsUsed: { ...rounds },
      transcriptRef: channel.channelId,
    },
  };
}
