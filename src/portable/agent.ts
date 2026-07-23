/**
 * KinweaveAgent — the on-device node that Claude drives through MCP tools. It
 * holds the keys + profile (Zone O) locally, talks to the relay, runs the tested
 * negotiation driver, and surfaces owner gates as things Claude asks you to
 * approve in chat. No API key: the intelligence is the user's Claude.
 *
 * Pure of MCP/stdio so it can be tested end-to-end in Node (see test/mcp-agent.test.ts).
 */

import { Node, fingerprint } from './crypto';
import { makeInvite, encodeKw1, decodeKw1, verifyInvite } from './invite';
import { connectRelay, type RelayConn } from './relay-connect';
import { Session } from './session';
import { NegotiationDriver } from '../core/negotiation-driver';
import { Persona } from '../persona/persona';
import { Clock } from '../core/clock';
import { approveAll } from '../persona/owner';
import type { PrivateProfile } from '../types/profile';
import type { GateRequest } from '../persona/owner';
import type { DriverTerminal } from '../types/negotiation';
import type { ProposedHangout } from '../types/artifact';

export type ConnState = 'idle' | 'waiting_for_scan' | 'negotiating' | 'done';

export interface AgentStatus {
  identity: string;
  connection: ConnState;
  pendingApproval: string | null; // human-readable; what the owner is being asked to approve
  outcome: 'committed' | 'abandoned' | null;
  hangout: string | null; // the committed plan, human-readable
}

export function describeGate(req: GateRequest): string {
  switch (req.gate) {
    case 'G1':
      return 'Connect with this person and let your Personas start talking?';
    case 'G2':
      return 'Start sharing your general preferences (activity types, rough availability)?';
    case 'G3':
      if (req.tierTo === 4) return 'Release your contact info so you two can actually meet up?';
      if (req.tierTo === 3) return 'Share your first name and neighborhood?';
      return `Share these specifics: ${(req.fields ?? []).join(', ')}?`;
    case 'G4':
      return req.artifact ? `Approve this hangout — ${describeHangout(req.artifact)}` : 'Approve this hangout?';
  }
}

export function describeHangout(art: ProposedHangout | undefined): string {
  if (!art) return '(no plan)';
  const p = art.plan;
  const when = p.time ? `${p.time.date} at ${p.time.start}` : 'a time you both picked';
  const where = p.place?.name ?? p.place?.type ?? 'a public spot';
  const conf = art.compatibilityRationale?.label ?? 'moderate';
  return `${p.activity.specific || p.activity.class} at ${where}, ${when} (match: ${conf}).`;
}

export class KinweaveAgent {
  private conn: RelayConn | null = null;
  private session: Session | null = null;
  private pendingGate: GateRequest | null = null;
  private terminal: DriverTerminal | null = null;
  private connState: ConnState = 'idle';
  private waiters: (() => void)[] = [];

  private cpName = '';
  private cpFp = '';

  constructor(
    private readonly node: Node,
    private readonly profile: PrivateProfile,
    private readonly relayUrl: string,
    /** Called when a hangout commits — the caller persists it as a connection. */
    private readonly onConnected?: (info: { id: string; name: string; hangout?: string }) => void,
  ) {}

  status(): AgentStatus {
    return {
      identity: this.node.id,
      connection: this.connState,
      pendingApproval: this.pendingGate ? describeGate(this.pendingGate) : null,
      outcome: this.terminal?.outcome ?? null,
      hangout: this.terminal?.outcome === 'committed' && this.terminal.artifact ? describeHangout(this.terminal.artifact) : null,
    };
  }

  /** Produce a code to show a friend (starts listening for them). */
  async makeConnectCode(): Promise<string> {
    await this.ensureConn('responder');
    this.connState = 'waiting_for_scan';
    const invite = makeInvite(this.node, {
      hobbyTags: this.profile.hobbyTags,
      geoCell: this.profile.geoCell,
      community: 'local',
      relays: [this.relayUrl],
    });
    return encodeKw1(invite);
  }

  /** Connect using a code a friend gave you (starts the negotiation as initiator). */
  async useConnectCode(code: string): Promise<void> {
    const parsed = decodeKw1(code);
    if (!parsed || parsed.kind !== 'invite') throw new Error('that code could not be read');
    if (!verifyInvite(parsed)) throw new Error('that code failed verification');
    const beacon = parsed.beacon;
    await this.ensureConn('initiator');
    this.session = this.build({ pubKey: beacon.pubKey, encPubKey: beacon.encPubKey }, fingerprint(beacon.pubKey), 'initiator');
    this.connState = 'negotiating';
    this.session.start();
  }

  approve(): boolean {
    if (!this.pendingGate || !this.session) return false;
    this.pendingGate = null;
    this.session.resolveGate({ approve: true });
    return true;
  }

  decline(): boolean {
    if (!this.pendingGate || !this.session) return false;
    this.pendingGate = null;
    this.session.resolveGate({ approve: false });
    return true;
  }

  /** Resolve when the next thing that needs the owner (a gate) or the outcome arrives. */
  waitForNext(timeoutMs = 25000): Promise<void> {
    if (this.pendingGate || this.terminal) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      this.waiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  close(): void {
    this.conn?.close();
  }

  // ---- internals -----------------------------------------------------------

  private notify(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  private async ensureConn(role: 'initiator' | 'responder'): Promise<void> {
    if (this.conn) return;
    this.conn = await connectRelay(this.relayUrl, this.node.identity, (env) => {
      if (!this.session && role === 'responder') {
        this.session = this.build({ pubKey: env.from, encPubKey: env.fromEnc }, fingerprint(env.from), 'responder');
        this.connState = 'negotiating';
      }
      this.session?.onEnvelope(env);
    });
  }

  private build(peer: { pubKey: string; encPubKey: string }, counterpartFp: string, role: 'initiator' | 'responder'): Session {
    this.cpFp = counterpartFp;
    const persona = new Persona(this.profile, counterpartFp, approveAll, new Clock(), {});
    const driver = new NegotiationDriver(persona, counterpartFp, role);
    return new Session(this.node, driver, peer, {
      send: (env) => this.conn!.send(env),
      onGateRequest: (req) => {
        this.pendingGate = req;
        this.connState = 'negotiating';
        this.notify();
      },
      onMessage: (m) => {
        const fn = (m.payload as Record<string, unknown>).firstName;
        if (m.type === 'DISCLOSE' && typeof fn === 'string') this.cpName = fn;
      },
      onTerminal: (t) => {
        this.terminal = t;
        this.pendingGate = null;
        this.connState = 'done';
        if (t.outcome === 'committed' && this.cpFp) this.onConnected?.({ id: this.cpFp, name: this.cpName, hangout: describeHangout(t.artifact) });
        this.notify();
      },
    });
  }
}
