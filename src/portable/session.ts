/**
 * Session — runs ONE device's half of the negotiation over the relay. It seals
 * every driver message to the peer, opens inbound ones, surfaces owner gates to
 * the UI (a human tap), and reports the final hangout. The driver (tested) does
 * the protocol; the Session is the crypto + transport wrapper around it.
 */

import type { Node, WireEnvelope } from './crypto';
import type { NegotiationDriver } from '../core/negotiation-driver';
import type { DriverOutput, DriverTerminal, GateDecision, GateRequest } from '../types/negotiation';
import type { Message } from '../types/envelope';

export interface SessionCallbacks {
  send: (env: WireEnvelope) => void;
  onGateRequest: (req: GateRequest) => void;
  onTerminal: (t: DriverTerminal) => void;
  onMessage?: (m: Message) => void;
}

export class Session {
  private peer: { pubKey: string; encPubKey: string } | null;

  constructor(
    private readonly node: Node,
    private readonly driver: NegotiationDriver,
    peer: { pubKey: string; encPubKey: string } | null,
    private readonly cb: SessionCallbacks,
  ) {
    this.peer = peer;
  }

  /** Begin (initiator emits HELLO; responder waits). */
  start(): void {
    this.pump(this.driver.run({ k: 'start' }));
  }

  /** Feed an inbound sealed envelope from the relay. */
  onEnvelope(env: WireEnvelope): void {
    if (!this.peer) this.peer = { pubKey: env.from, encPubKey: env.fromEnc };
    const pt = this.node.open(env);
    if (pt === null) return; // not for us / undecryptable
    let msg: Message;
    try {
      msg = JSON.parse(pt) as Message;
    } catch {
      return;
    }
    this.cb.onMessage?.(msg);
    this.pump(this.driver.run({ k: 'inbound', msg }));
  }

  /** The owner answered the outstanding gate (a tap in the UI). */
  resolveGate(decision: GateDecision): void {
    this.pump(this.driver.run({ k: 'gateResult', decision }));
  }

  private pump(out: DriverOutput): void {
    if (this.peer) {
      for (const m of out.outbound) this.cb.send(this.node.seal(this.peer, JSON.stringify(m)));
    }
    if (out.terminal) {
      this.cb.onTerminal(out.terminal);
      return;
    }
    if (out.gateRequest) this.cb.onGateRequest(out.gateRequest);
  }
}
