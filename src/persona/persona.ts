/**
 * A Persona actor. Holds its owner's private profile (Zone O) as a PRIVATE field
 * — the orchestrator/state machine never reads it. The Persona can only emit
 * outbound data through its Disclosure Gate, and treats every inbound message as
 * untrusted DATA. See spec/00-overview.md.
 */

import { PROTOCOL_VERSION, type Message, type MsgType, type Stage } from '../types/envelope';
import { FIELD_TIER, Tier } from '../types/disclosure';
import type { PrivateProfile } from '../types/profile';
import type { GateDecision, GateRequest, OwnerPolicy } from './owner';
import { DisclosureGate } from '../core/disclosure-gate';
import { ConsentLedger } from '../core/consent-ledger';
import { quantize, ProbeLimiter, tagOverlap, matchBand, type MatchBand } from '../core/compatibility';
import { frameInbound, type FramedInbound } from '../core/inbound-envelope';
import { venueFor } from '../core/venues';
import type { Clock } from '../core/clock';

export interface PersonaOptions {
  /** Jailbroken/over-eager: the model TRIES to leak forbidden + above-tier fields.
   *  The Gate must still refuse them — this proves structural (not prompt) enforcement. */
  overshare?: boolean;
  /** Over-sell: field keys the persona asserts WITHOUT grounding in the verified profile. */
  unverifiedFields?: string[];
  /** Picky planner: always counters plan proposals (used to exhaust the coplan cap). */
  pickyPlanner?: boolean;
  /** Fail the two-phase commit (never sends COMMIT_CONFIRM). */
  failCommit?: boolean;
}

/** Fields the Gate is asked to leak when a persona is "jailbroken". */
const FORBIDDEN_LEAK = {
  homeCoordinate: { lat: 0, lng: 0 },
  interestVector: [0.9, 0.9, 0.9],
  legalName: 'REDACTED-LEGAL-NAME',
};

export interface PerCounterpartState {
  allowedTier: Tier; // highest tier this persona may emit toward the counterpart
  revealedKeys: Set<string>;
  theyRevealedKeys: Set<string>;
  counterpartTier: Tier;
}

export class Persona {
  readonly handle: string;
  readonly ownerId: string;
  readonly ledger: ConsentLedger;
  private readonly profile: PrivateProfile; // Zone O — never exposed
  private readonly gate: DisclosureGate;
  private readonly verifiedFields: Set<string>;
  private readonly probes: ProbeLimiter;
  private msgCounter = 0;
  private state: PerCounterpartState = {
    allowedTier: Tier.T1, // T0/T1 are open once a consented channel exists
    revealedKeys: new Set(),
    theyRevealedKeys: new Set(),
    counterpartTier: Tier.T0,
  };

  constructor(
    profile: PrivateProfile,
    private readonly counterpartOwner: string,
    private readonly policy: OwnerPolicy,
    clock: Clock,
    private readonly opts: PersonaOptions = {},
    probeCap = 3,
  ) {
    this.profile = profile;
    this.handle = profile.handle;
    this.ownerId = profile.ownerId;
    this.ledger = new ConsentLedger(profile.ownerId, clock);
    this.gate = new DisclosureGate(profile.ownerId, counterpartOwner, this.ledger);
    this.probes = new ProbeLimiter(probeCap);
    // A persona is "grounded" for every standard protocol field key; the
    // over-sell guard marks any explicitly-unverified field as inferred.
    this.verifiedFields = new Set(Object.keys(FIELD_TIER));
    for (const k of opts.unverifiedFields ?? []) this.verifiedFields.delete(k);
  }

  // ---- public / discovery ----------------------------------------------------

  publicCard() {
    return {
      handle: this.profile.handle,
      community: this.profile.community,
      hobbyTags: [...this.profile.hobbyTags],
      geoCell: this.profile.geoCell,
    };
  }

  /** Coarse, non-invertible signal a counterpart peer matches on locally. The raw vector never leaves. */
  coarseSignal() {
    return {
      quant: quantize(this.profile.interestVector),
      hobbyTags: [...this.profile.hobbyTags],
      valueTags: [...this.profile.valueTags],
    };
  }

  // ---- owner-in-the-loop -----------------------------------------------------

  /** Evaluate a gate WITHOUT side effects. In the sim this consults the owner
   *  policy; in the real app the human's tap supplies the decision instead. */
  decideGate(req: GateRequest): GateDecision {
    return this.policy(req);
  }

  /** Record an approved gate: append the consent-grant (+ any level-change) and
   *  return the grant id that authorizes subsequent disclosure. Call ONLY after
   *  a positive decision — this is the effectful half of an owner gate. */
  recordGrant(req: GateRequest): string {
    const grant = this.ledger.append({
      type: 'consent-grant',
      gate: req.gate,
      counterpart: req.counterpart,
      tierTo: req.tierTo,
      fields: req.fields,
    });
    if (req.tierTo !== undefined && req.tierTo > this.state.allowedTier) {
      const prev = this.state.allowedTier;
      this.state.allowedTier = req.tierTo;
      this.ledger.append({
        type: 'level-change',
        counterpart: req.counterpart,
        tierFrom: prev,
        tierTo: req.tierTo,
        authorizingConsent: grant.id,
      });
    }
    return grant.id;
  }

  /** Ask the owner to approve a gate (sim convenience = decide + record). On
   *  approval an append-only consent-grant is recorded; its id authorizes
   *  subsequent disclosure. The async driver uses decideGate + recordGrant. */
  requestConsent(req: GateRequest): { decision: GateDecision; grantId?: string } {
    const decision = this.decideGate(req);
    if (!decision.approve || decision.defer) return { decision };
    return { decision, grantId: this.recordGrant(req) };
  }

  // ---- inbound (untrusted) ---------------------------------------------------

  /** Ingest an inbound message as DATA. Frames NL content as untrusted, flags
   *  injection, and logs receipt. NEVER mutates tier/consent/logging. */
  ingestInbound(msg: Message): FramedInbound {
    const framed = frameInbound(msg.text);
    this.ledger.append({
      type: 'inbound-received',
      counterpart: msg.env.fromPersona,
      note: msg.type,
      injectionFlag: framed.injectionFlag,
    });
    if (framed.injectionFlag) {
      this.ledger.append({
        type: 'injection-flag',
        counterpart: msg.env.fromPersona,
        reason: framed.matched.join(','),
      });
    }
    // Record what the counterpart disclosed (their keys), for reciprocity + audit.
    for (const key of Object.keys(msg.payload)) {
      this.state.theyRevealedKeys.add(key);
    }
    return framed;
  }

  // ---- message construction (all via the Gate) -------------------------------

  private envelope(type: MsgType, stage: Stage, tier: Tier, gateRef?: string, inReplyTo?: string) {
    return {
      msgId: `${this.ownerId}-m${++this.msgCounter}`,
      channelId: '', // stamped by the Channel
      protocolVersion: PROTOCOL_VERSION,
      fromPersona: this.handle,
      stage,
      seq: 0, // stamped by the Channel
      inReplyTo,
      nonce: `${this.ownerId}-n${this.msgCounter}`,
      sig: `sig(${this.ownerId})`,
      disclosureTier: tier,
      ownerGateRef: gateRef,
    };
  }

  hello(counterpart: string): Message {
    return {
      env: this.envelope('HELLO', 'S1', Tier.T0),
      type: 'HELLO',
      payload: { ...this.publicCard(), min_match_theta: 0.45 },
    };
  }

  helloAck(inReplyTo: string): Message {
    return {
      env: this.envelope('HELLO_ACK', 'S1', Tier.T0, undefined, inReplyTo),
      type: 'HELLO_ACK',
      payload: { ...this.publicCard() },
    };
  }

  /** S2 SIGNAL — coarse machine-signal, no free text. */
  signalMessage(): Message {
    const fields: Record<string, unknown> = {
      interestSignal: quantize(this.profile.interestVector),
      valueTags: [...this.profile.valueTags],
      availabilityMask: this.profile.availabilityMask,
      groupPref: this.profile.groupPref,
      hobbyTags: [...this.profile.hobbyTags],
    };
    if (this.opts.overshare) Object.assign(fields, FORBIDDEN_LEAK, { firstName: this.profile.firstName });
    const { allowed } = this.gate.filterOutbound({
      tier: Tier.T1,
      fields,
      counterpart: this.counterpartOwner,
      verifiedFields: this.verifiedFields,
    });
    return { env: this.envelope('SIGNAL', 'S2', Tier.T1), type: 'SIGNAL', payload: allowed };
  }

  /** Assess a counterpart's coarse signal into a match band (probe-capped). */
  assessMatch(theirSignal: Record<string, unknown>): { band: MatchBand | null; capped: boolean } {
    if (!this.probes.tryProbe(this.counterpartOwner)) {
      return { band: null, capped: true };
    }
    const theirQuant = (theirSignal.interestSignal as number[] | undefined) ?? [];
    const theirTags = (theirSignal.hobbyTags as string[] | undefined) ?? [];
    const shared = tagOverlap(this.profile.hobbyTags, theirTags);
    const band = matchBand(quantize(this.profile.interestVector), theirQuant, shared.length);
    return { band, capped: false };
  }

  /** S3 INTENT_FRAME — abstract archetype (T1) + NL text (evaluated as data). */
  intentFrame(): Message {
    const archetype = {
      activityClasses: [...this.profile.activityClasses],
      energyLevel: this.profile.energyLevel,
      timeBands: [...this.profile.timeBands],
      settingPref: this.profile.settingPref,
    };
    const { allowed } = this.gate.filterOutbound({
      tier: Tier.T1,
      fields: { intentArchetype: archetype },
      counterpart: this.counterpartOwner,
      verifiedFields: this.verifiedFields,
    });
    return {
      env: this.envelope('INTENT_FRAME', 'S3', Tier.T1),
      type: 'INTENT_FRAME',
      payload: allowed,
      text: `My owner tends to enjoy ${this.profile.activityClasses.join('/')} at ${this.profile.energyLevel} energy, ${this.profile.timeBands.join(' or ')}, in ${this.profile.settingPref} settings.`,
    };
  }

  archetype(): { activityClasses: string[]; timeBands: string[] } {
    return {
      activityClasses: [...this.profile.activityClasses],
      timeBands: [...this.profile.timeBands],
    };
  }

  /** S4 DISCLOSE — reveal one tier's fields, gated by a consent grant. */
  discloseTier(tier: Tier, grantId: string): Message {
    const fields = this.fieldsForTier(tier);
    if (this.opts.overshare) Object.assign(fields, FORBIDDEN_LEAK);
    const { allowed } = this.gate.filterOutbound({
      tier,
      fields,
      counterpart: this.counterpartOwner,
      gateRef: grantId,
      verifiedFields: this.verifiedFields,
    });
    for (const k of Object.keys(allowed)) this.state.revealedKeys.add(k);
    return { env: this.envelope('DISCLOSE', 'S4', tier, grantId), type: 'DISCLOSE', payload: allowed };
  }

  private fieldsForTier(tier: Tier): Record<string, unknown> {
    if (tier === Tier.T2) {
      return {
        activityClass: [...this.profile.activityClasses],
        energyLevel: this.profile.energyLevel,
        timeBand: [...this.profile.timeBands],
        settingPref: this.profile.settingPref,
        hardConstraints: [...this.profile.hardConstraints],
        noveltyPref: this.profile.noveltyPref,
      };
    }
    if (tier === Tier.T3) {
      return { firstName: this.profile.firstName, neighborhood: this.profile.geoCell };
    }
    if (tier === Tier.T4) {
      return { contact: this.profile.contact };
    }
    return {};
  }

  // ---- S5 coplanning ---------------------------------------------------------

  proposePlan(sharedActivities: string[], sharedTimeBands: string[], grantId: string, round: number): Message {
    const activity = sharedActivities[0] ?? this.profile.activityClasses[0] ?? 'games';
    const timeBand = sharedTimeBands[0] ?? this.profile.timeBands[0] ?? 'weekend_day';
    const venue = venueFor(activity);
    // T3 plan specifics — venue candidate + concrete time slot.
    const fields = {
      venueCandidate: { name: venue.name, type: venue.type, geoCell: venue.geoCell, isPublic: venue.isPublic },
      timeSlot: slotForBand(timeBand, round),
    };
    const { allowed } = this.gate.filterOutbound({
      tier: Tier.T3,
      fields,
      counterpart: this.counterpartOwner,
      gateRef: grantId,
      verifiedFields: this.verifiedFields,
    });
    return {
      env: this.envelope('PLAN_PROPOSAL', 'S5', Tier.T3, grantId),
      type: 'PLAN_PROPOSAL',
      payload: allowed,
      text: `Proposing ${activity} at ${venue.name} (${timeBand}). Public venue, daytime.`,
    };
  }

  reviewPlan(proposal: Message, sharedActivities: string[]): Message {
    const venue = proposal.payload.venueCandidate as { type?: string; isPublic?: boolean } | undefined;
    const publicOk = venue?.isPublic === true;
    const accept = publicOk && !this.opts.pickyPlanner;
    return {
      env: this.envelope('PLAN_REVIEW', 'S5', Tier.T1, undefined, proposal.env.msgId),
      type: 'PLAN_REVIEW',
      payload: { decision: accept ? 'accept' : 'counter' },
      text: accept ? 'Works for my owner.' : 'My owner would prefer a different time — can we adjust?',
    };
  }

  // ---- S7 commit -------------------------------------------------------------

  commitIntent(artifactHash: string, grantId: string): Message {
    return {
      env: this.envelope('COMMIT_INTENT', 'S7', Tier.T3, grantId),
      type: 'COMMIT_INTENT',
      payload: { artifactHash },
    };
  }

  commitConfirm(artifactHash: string, grantId: string): Message | null {
    if (this.opts.failCommit) return null; // never confirms -> commit_failed
    // T4 coordination handle released post-commit, gated.
    const { allowed } = this.gate.filterOutbound({
      tier: Tier.T4,
      fields: { contact: this.profile.contact },
      counterpart: this.counterpartOwner,
      gateRef: grantId,
      verifiedFields: this.verifiedFields,
    });
    return {
      env: this.envelope('COMMIT_CONFIRM', 'S7', Tier.T4, grantId),
      type: 'COMMIT_CONFIRM',
      payload: { artifactHash, coordination: allowed },
    };
  }

  abandon(code: string, publicReason: string): Message {
    return {
      env: this.envelope('ABANDON', 'S8', Tier.T0),
      type: 'ABANDON',
      payload: { code, publicReason },
      text: publicReason,
    };
  }

  // ---- read-only views for audit/tests --------------------------------------

  revealedKeys(): string[] {
    return [...this.state.revealedKeys];
  }
  allowedTier(): Tier {
    return this.state.allowedTier;
  }
}

/** Map a coarse time band to a concrete slot (round nudges the time on counters). */
function slotForBand(band: string, round: number): { date: string; start: string; end: string; timezone: string } {
  const base: Record<string, { date: string; start: string }> = {
    weekend_day: { date: '2026-08-01', start: '11:00' },
    weekend_eve: { date: '2026-08-01', start: '18:00' },
    weekday_day: { date: '2026-07-29', start: '12:00' },
    weekday_eve: { date: '2026-07-29', start: '18:30' },
  };
  const b = base[band] ?? base.weekend_day!;
  const startHour = parseInt(b.start.slice(0, 2), 10) + round; // shift on re-proposals
  const start = `${String(startHour).padStart(2, '0')}:${b.start.slice(3)}`;
  const end = `${String(startHour + 2).padStart(2, '0')}:${b.start.slice(3)}`;
  return { date: b.date, start, end, timezone: 'local' };
}
