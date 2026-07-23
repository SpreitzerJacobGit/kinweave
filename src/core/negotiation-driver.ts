/**
 * NegotiationDriver — the event-driven, per-node half of the S0..S8 machine.
 *
 * Each real device runs ONE driver (over its own Persona). It reacts to inbound
 * messages arriving over the relay and to owner-gate answers that may come hours
 * later. It NEVER drives the counterpart; symmetric stages advance only when both
 * "sentMine" and "gotTheirs" are true, so arrival order and long gaps are fine.
 *
 * The structural safety guarantees are unchanged: every outbound field still
 * passes the Disclosure Gate (via Persona methods), and consent is recorded
 * (Persona.recordGrant) BEFORE any gated field leaves. See spec/01 + spec/08.
 */

import { Tier } from '../types/disclosure';
import type { AbandonCode, Message } from '../types/envelope';
import type { Persona } from '../persona/persona';
import type { DriverEvent, DriverOutput, DriverTerminal, Role } from '../types/negotiation';
import { buildArtifact, Caps, DEFAULT_CAPS, FACE_SAVING, intersect } from './negotiation-core';
import type { GateRequest } from '../persona/owner';
import type { Attestation } from '../types/attestation';

/**
 * Optional community-trust wiring (spec/10 §4). When a negotiation happens inside
 * a community, the joiner carries its attestation bundle in the sealed HELLO and
 * the receiver runs `connectGate` on it BEFORE G1. Omitted for plain pairwise
 * negotiations, which behave exactly as before.
 */
export interface TrustWiring {
  /** This node's own bundle to attach to its outbound HELLO/HELLO_ACK. */
  selfAttestations?: Attestation[];
  /** This node's fingerprint, declared alongside its bundle so the peer can subject-bind it. */
  selfSubject?: string;
  /** Gate the counterpart's declared identity + bundle; false → abandon('policy_unmet') before G1. */
  connectGate?: (subjectFp: string, bundle: Attestation[]) => boolean;
}

interface Flags {
  sentHello: boolean; gotHello: boolean; sentAck: boolean; gotAck: boolean;
  g1req: boolean; g1done: boolean;
  sentSignal: boolean; gotSignal: boolean; matchEval: boolean;
  sentIntent: boolean; gotIntent: boolean; archEval: boolean;
  g2req: boolean; g2done: boolean;
  t2req: boolean; t2granted: boolean; sentT2: boolean; gotT2: boolean;
  t3req: boolean; t3granted: boolean; sentT3: boolean; gotT3: boolean;
  coplanStarted: boolean; acceptedSet: boolean;
  artifactBuilt: boolean; g4req: boolean; g4done: boolean;
  sentCommitIntent: boolean; gotCommitIntent: boolean;
  t4req: boolean; t4granted: boolean;
  sentCommitConfirm: boolean; gotCommitConfirm: boolean;
}

const T2_FIELDS = ['activityClass', 'hardConstraints', 'noveltyPref'];
const T3_FIELDS = ['firstName', 'neighborhood'];

export class NegotiationDriver {
  private f: Flags = {
    sentHello: false, gotHello: false, sentAck: false, gotAck: false,
    g1req: false, g1done: false,
    sentSignal: false, gotSignal: false, matchEval: false,
    sentIntent: false, gotIntent: false, archEval: false,
    g2req: false, g2done: false,
    t2req: false, t2granted: false, sentT2: false, gotT2: false,
    t3req: false, t3granted: false, sentT3: false, gotT3: false,
    coplanStarted: false, acceptedSet: false,
    artifactBuilt: false, g4req: false, g4done: false,
    sentCommitIntent: false, gotCommitIntent: false,
    t4req: false, t4granted: false,
    sentCommitConfirm: false, gotCommitConfirm: false,
  };

  private outbox: Message[] = [];
  private transcript: Message[] = [];
  private pendingGate: GateRequest | null = null;
  private terminal: DriverTerminal | null = null;

  private cpHandle: string | null = null;
  private theirSignal: Record<string, unknown> = {};
  private theirArchetype: { activityClasses: string[]; timeBands: string[] } = { activityClasses: [], timeBands: [] };
  private shared: { activities: string[]; timeBands: string[] } = { activities: [], timeBands: [] };
  private band: 'low' | 'medium' | 'high' = 'medium';

  private t2Grant = '';
  private t3Grant = '';
  private g4Grant = '';
  private t4Grant = '';

  private coplanRound = 0;
  private lastProposal: Message | null = null;
  private accepted: Message | null = null;
  private pendingProposal: Message | null = null;
  private pendingReview: string | null = null;
  private artifact = null as ReturnType<typeof buildArtifact> | null;
  private readonly stages = new Set<string>(['S0']);
  private readonly rounds = { probe: 0, align: 0, coplan: 0, owner: 0 };

  constructor(
    private readonly persona: Persona,
    private readonly counterpartOwnerId: string,
    private readonly role: Role,
    private readonly negId = 'neg-1',
    private readonly caps: Caps = DEFAULT_CAPS,
    private readonly trust: TrustWiring = {},
  ) {}

  /** Process one event and return anything to emit / surface. */
  run(event: DriverEvent): DriverOutput {
    this.outbox = [];
    switch (event.k) {
      case 'start':
        break;
      case 'inbound':
        this.onInbound(event.msg);
        break;
      case 'gateResult':
        this.applyGate(event.decision);
        break;
      case 'timer':
        break; // deadline checks would live here (wall-clock); MVP relies on gate answers
    }
    this.drive();
    return {
      outbound: this.outbox,
      gateRequest: this.pendingGate ?? undefined,
      terminal: this.terminal ?? undefined,
    };
  }

  terminalState(): DriverTerminal | null {
    return this.terminal;
  }

  // ---- inbound ---------------------------------------------------------------

  private readonly processed = new Set<string>();

  private onInbound(msg: Message): void {
    // Idempotent replay: store-and-forward relays can redeliver. Drop duplicates.
    if (this.processed.has(msg.env.msgId)) return;
    this.processed.add(msg.env.msgId);
    this.transcript.push(msg);
    if (!this.cpHandle) this.cpHandle = msg.env.fromPersona;
    this.persona.ingestInbound(msg);
    switch (msg.type) {
      case 'HELLO':
        this.f.gotHello = true;
        this.checkCommunity(msg);
        break;
      case 'HELLO_ACK':
        this.f.gotAck = true;
        this.checkCommunity(msg);
        break;
      case 'SIGNAL':
        this.f.gotSignal = true;
        this.theirSignal = msg.payload;
        break;
      case 'INTENT_FRAME':
        this.f.gotIntent = true;
        this.theirArchetype = (msg.payload.intentArchetype as { activityClasses: string[]; timeBands: string[] }) ?? this.theirArchetype;
        break;
      case 'DISCLOSE':
        if (msg.env.disclosureTier === Tier.T2) this.f.gotT2 = true;
        else if (msg.env.disclosureTier === Tier.T3) this.f.gotT3 = true;
        break;
      case 'PLAN_PROPOSAL':
        this.pendingProposal = msg;
        break;
      case 'PLAN_REVIEW':
        this.pendingReview = (msg.payload.decision as string) ?? 'counter';
        break;
      case 'COMMIT_INTENT':
        this.f.gotCommitIntent = true;
        break;
      case 'COMMIT_CONFIRM':
        this.f.gotCommitConfirm = true;
        break;
      case 'ABANDON':
        if (!this.terminal) this.terminal = { outcome: 'abandoned', code: msg.payload.code as AbandonCode };
        break;
    }
  }

  private checkCommunity(msg: Message): void {
    const theirs = msg.payload.community as string | undefined;
    if (theirs && theirs !== this.persona.publicCard().community) return this.abandon('low_match');
    // Community trust policy (spec/10 §4): the joiner's bundle rides in the sealed
    // HELLO; gate connectability here, BEFORE G1. No gate configured → no-op.
    if (this.trust.connectGate) {
      const bundle = (msg.payload.attestations as Attestation[] | undefined) ?? [];
      const subject = (msg.payload.subject as string | undefined) ?? '';
      if (!this.trust.connectGate(subject, bundle)) this.abandon('policy_unmet');
    }
  }

  /** Attach this node's declared identity + attestation bundle to an outbound HELLO/HELLO_ACK. */
  private withAttestations(msg: Message): Message {
    const p = msg.payload as Record<string, unknown>;
    if (this.trust.selfAttestations && this.trust.selfAttestations.length) p.attestations = this.trust.selfAttestations;
    if (this.trust.selfSubject) p.subject = this.trust.selfSubject;
    return msg;
  }

  // ---- the drive loop --------------------------------------------------------

  private drive(): void {
    let guard = 0;
    while (!this.terminal && !this.pendingGate && guard++ < 200) {
      if (!this.step()) break;
    }
  }

  private step(): boolean {
    const f = this.f;
    // S1 handshake
    if (this.role === 'initiator' && !f.sentHello) {
      this.emit(this.withAttestations(this.persona.hello(this.counterpartOwnerId)));
      f.sentHello = true;
      return true;
    }
    if (this.role === 'responder' && f.gotHello && !f.sentAck) {
      this.emit(this.withAttestations(this.persona.helloAck(this.transcript[this.transcript.length - 1]?.env.msgId ?? '')));
      f.sentAck = true;
      return true;
    }
    // G1 connection gate
    if (this.handshakeDone() && !f.g1req && !f.g1done) {
      this.requestGate({ gate: 'G1', counterpart: this.counterpartOwnerId });
      f.g1req = true;
      return true;
    }
    // S2 signal
    if (f.g1done && !f.sentSignal) {
      this.stages.add('S2');
      this.emit(this.persona.signalMessage());
      f.sentSignal = true;
      return true;
    }
    if (f.sentSignal && f.gotSignal && !f.matchEval) {
      f.matchEval = true;
      this.rounds.probe = 1;
      const m = this.persona.assessMatch(this.theirSignal);
      this.band = m.band ?? 'medium';
      if (m.capped || m.band === 'low') this.abandon('low_match');
      return true;
    }
    // S3 intent
    if (f.matchEval && !f.sentIntent) {
      this.stages.add('S3');
      this.emit(this.persona.intentFrame());
      f.sentIntent = true;
      return true;
    }
    if (f.sentIntent && f.gotIntent && !f.archEval) {
      f.archEval = true;
      this.rounds.align = 1;
      const self = this.persona.archetype();
      this.shared = {
        activities: intersect(self.activityClasses, this.theirArchetype.activityClasses),
        timeBands: intersect(self.timeBands, this.theirArchetype.timeBands),
      };
      if (!this.shared.activities.length || !this.shared.timeBands.length) this.abandon('archetype_mismatch');
      return true;
    }
    // G2 disclosure consent
    if (f.archEval && !f.g2req && !f.g2done) {
      this.requestGate({ gate: 'G2', counterpart: this.counterpartOwnerId, tierTo: Tier.T2 });
      f.g2req = true;
      return true;
    }
    // S4 disclosure ladder
    if (f.g2done && !f.t2req && !f.t2granted) {
      this.stages.add('S4');
      this.requestGate({ gate: 'G3', counterpart: this.counterpartOwnerId, tierTo: Tier.T2, fields: T2_FIELDS });
      f.t2req = true;
      return true;
    }
    if (f.t2granted && !f.sentT2) {
      this.emit(this.persona.discloseTier(Tier.T2, this.t2Grant));
      f.sentT2 = true;
      return true;
    }
    if (f.sentT2 && f.gotT2 && !f.t3req && !f.t3granted) {
      this.requestGate({ gate: 'G3', counterpart: this.counterpartOwnerId, tierTo: Tier.T3, fields: T3_FIELDS });
      f.t3req = true;
      return true;
    }
    if (f.t3granted && !f.sentT3) {
      this.emit(this.persona.discloseTier(Tier.T3, this.t3Grant));
      f.sentT3 = true;
      return true;
    }
    // S5 coplan
    if (f.sentT3 && f.gotT3 && !f.coplanStarted) {
      this.stages.add('S5');
      f.coplanStarted = true;
      this.coplanRound = 0;
      if (this.amIProposer(0)) this.sendProposal();
      return true;
    }
    if (this.pendingProposal) {
      const prop = this.pendingProposal;
      this.pendingProposal = null;
      this.onProposal(prop);
      return true;
    }
    if (this.pendingReview !== null) {
      const decision = this.pendingReview;
      this.pendingReview = null;
      this.onReview(decision);
      return true;
    }
    // S6 build + G4
    if (f.acceptedSet && !f.artifactBuilt) {
      this.stages.add('S6');
      this.buildArt();
      f.artifactBuilt = true;
      return true;
    }
    if (f.artifactBuilt && !f.g4req && !f.g4done) {
      this.rounds.owner = 1;
      this.requestGate({ gate: 'G4', counterpart: this.counterpartOwnerId, artifact: this.artifact! });
      f.g4req = true;
      return true;
    }
    // S7 commit
    if (f.g4done && !f.sentCommitIntent) {
      this.stages.add('S7');
      this.emit(this.persona.commitIntent(this.artifact!.versionHash, this.g4Grant));
      f.sentCommitIntent = true;
      return true;
    }
    if (f.sentCommitIntent && f.gotCommitIntent && !f.t4req && !f.t4granted) {
      this.requestGate({ gate: 'G3', counterpart: this.counterpartOwnerId, tierTo: Tier.T4, fields: ['contact'] });
      f.t4req = true;
      return true;
    }
    if (f.t4granted && !f.sentCommitConfirm) {
      const cc = this.persona.commitConfirm(this.artifact!.versionHash, this.t4Grant);
      if (!cc) {
        this.abandon('commit_failed');
      } else {
        this.emit(cc);
        f.sentCommitConfirm = true;
      }
      return true;
    }
    if (f.sentCommitConfirm && f.gotCommitConfirm && !this.terminal) {
      this.stages.add('S8');
      this.artifact!.status = 'committed';
      this.terminal = { outcome: 'committed', artifact: this.artifact! };
      return true;
    }
    return false;
  }

  // ---- coplan ----------------------------------------------------------------

  private sendProposal(): void {
    const prop = this.persona.proposePlan(this.shared.activities, this.shared.timeBands, this.t3Grant, this.coplanRound);
    this.lastProposal = prop;
    this.rounds.coplan += 1;
    this.emit(prop);
  }

  private onProposal(prop: Message): void {
    const rev = this.persona.reviewPlan(prop, this.shared.activities);
    this.emit(rev);
    if (rev.payload.decision === 'accept') {
      this.accepted = prop;
      this.f.acceptedSet = true;
    } else {
      this.coplanRound += 1;
      if (this.coplanRound >= this.caps.coplan) this.abandon('no_feasible_plan');
      else if (this.amIProposer(this.coplanRound)) this.sendProposal();
    }
  }

  private onReview(decision: string): void {
    if (decision === 'accept') {
      this.accepted = this.lastProposal;
      this.f.acceptedSet = true;
    } else {
      this.coplanRound += 1;
      if (this.coplanRound >= this.caps.coplan) this.abandon('no_feasible_plan');
      // else: I become reviewer; the counterpart sends the next proposal.
    }
  }

  private amIProposer(round: number): boolean {
    const proposerRole: Role = round % 2 === 0 ? 'initiator' : 'responder';
    return this.role === proposerRole;
  }

  // ---- artifact --------------------------------------------------------------

  private buildArt(): void {
    this.artifact = buildArtifact({
      proposal: this.accepted!,
      selfHandle: this.persona.handle,
      selfOwnerId: this.persona.ownerId,
      counterpartHandle: this.cpHandle ?? 'peer',
      counterpartOwnerId: this.counterpartOwnerId,
      selfRevealedKeys: this.persona.revealedKeys(),
      counterpartRevealedKeys: this.counterpartRevealedKeys(),
      transcript: this.transcript,
      stages: [...this.stages].sort() as never,
      rounds: this.rounds,
      transcriptRef: this.negId,
      band: this.band,
    });
  }

  private counterpartRevealedKeys(): string[] {
    const keys = new Set<string>();
    for (const m of this.transcript) {
      if (m.type === 'DISCLOSE' && m.env.fromPersona === this.cpHandle) {
        for (const k of Object.keys(m.payload)) keys.add(k);
      }
    }
    return [...keys];
  }

  // ---- gates -----------------------------------------------------------------

  private requestGate(req: GateRequest): void {
    this.pendingGate = req;
  }

  private applyGate(decision: import('../persona/owner').GateDecision): void {
    const req = this.pendingGate;
    this.pendingGate = null;
    if (!req) return;
    if (decision.defer) {
      this.abandon(req.gate === 'G1' ? 'timeout' : 'owner_timeout');
      return;
    }
    if (!decision.approve) {
      if (req.gate === 'G4' && this.artifact) this.artifact.status = 'declined';
      this.abandon(this.denyCode(req));
      return;
    }
    const grantId = this.persona.recordGrant(req);
    if (req.gate === 'G1') this.f.g1done = true;
    else if (req.gate === 'G2') this.f.g2done = true;
    else if (req.gate === 'G4') {
      this.g4Grant = grantId;
      this.f.g4done = true;
      if (this.artifact) this.artifact.status = 'approved';
    } else if (req.gate === 'G3' && req.tierTo === Tier.T2) {
      this.t2Grant = grantId;
      this.f.t2granted = true;
    } else if (req.gate === 'G3' && req.tierTo === Tier.T3) {
      this.t3Grant = grantId;
      this.f.t3granted = true;
    } else if (req.gate === 'G3' && req.tierTo === Tier.T4) {
      this.t4Grant = grantId;
      this.f.t4granted = true;
    }
  }

  private denyCode(req: GateRequest): AbandonCode {
    if (req.gate === 'G1') return 'declined';
    if (req.gate === 'G4') return 'owner_declined';
    return 'disclosure_refused';
  }

  // ---- helpers ---------------------------------------------------------------

  private handshakeDone(): boolean {
    return this.role === 'initiator' ? this.f.gotAck : this.f.gotHello && this.f.sentAck;
  }

  private emit(msg: Message): void {
    this.outbox.push(msg);
    this.transcript.push(msg);
  }

  private abandon(code: AbandonCode, silent = false): void {
    if (this.terminal) return;
    this.terminal = { outcome: 'abandoned', code };
    if (!silent) this.emit(this.persona.abandon(code, FACE_SAVING[code]));
  }
}
