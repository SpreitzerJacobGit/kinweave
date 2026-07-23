/**
 * Types for the event-driven, per-node negotiation driver (src/core/negotiation-driver.ts).
 * Each real device runs ONE half of the S0..S8 machine, reacting to inbound
 * messages that arrive over the relay — possibly hours apart — while owner gates
 * pause the flow. See spec/01-state-machine.md and spec/08-p2p-architecture.md.
 */

import type { GateDecision, GateRequest } from '../persona/owner';
import type { AbandonCode, Message } from './envelope';
import type { ProposedHangout } from './artifact';

export type Role = 'initiator' | 'responder';

export type DriverEvent =
  | { k: 'start' } // begin (initiator sends HELLO)
  | { k: 'inbound'; msg: Message } // a message arrived from the counterpart
  | { k: 'gateResult'; decision: GateDecision } // the owner answered the outstanding gate
  | { k: 'timer'; now: number }; // wall-clock tick (deadline checks)

export interface DriverTerminal {
  outcome: 'committed' | 'abandoned';
  code?: AbandonCode;
  artifact?: ProposedHangout;
}

export interface DriverOutput {
  /** Messages to seal + send to the counterpart over the relay. */
  outbound: Message[];
  /** If set, the caller must surface this to the owner and feed back a `gateResult`. */
  gateRequest?: GateRequest;
  /** Set once the negotiation has ended. */
  terminal?: DriverTerminal;
}

export type { GateDecision, GateRequest };
