/**
 * In-memory pump that drives two NegotiationDrivers against each other. Used by
 * tests (parity vs the synchronous reference) and by the local two-node demo.
 * Owner gates are auto-resolved via each Persona's policy (`decideGate`), the
 * same way the synchronous `negotiate()` consults the policy — so outcomes are
 * comparable. A real device resolves gates with a human tap instead.
 */

import type { Message } from '../types/envelope';
import type { DriverTerminal } from '../types/negotiation';
import type { Persona } from '../persona/persona';
import type { NegotiationDriver } from './negotiation-driver';

export interface Side {
  driver: NegotiationDriver;
  persona: Persona;
}

export interface PumpOptions {
  reorder?: boolean; // deliver LIFO instead of FIFO (stress arrival order)
  duplicate?: boolean; // redeliver every message once (stress idempotency)
}

/** Advance a side by one event, auto-resolving any owner gates, collecting all outbound. */
function advance(side: Side, event: Parameters<NegotiationDriver['run']>[0]): Message[] {
  let out = side.driver.run(event);
  const outbound = [...out.outbound];
  let guard = 0;
  while (out.gateRequest && !out.terminal && guard++ < 50) {
    const decision = side.persona.decideGate(out.gateRequest);
    out = side.driver.run({ k: 'gateResult', decision });
    outbound.push(...out.outbound);
  }
  return outbound;
}

export function pumpLocal(A: Side, B: Side, opts: PumpOptions = {}): { a: DriverTerminal | null; b: DriverTerminal | null } {
  const queue: { to: Side; msg: Message }[] = [];
  const enqueue = (to: Side, msgs: Message[]) => {
    for (const m of msgs) queue.push({ to, msg: m });
  };

  enqueue(B, advance(A, { k: 'start' }));
  enqueue(A, advance(B, { k: 'start' }));

  let guard = 0;
  while (queue.length && guard++ < 2000) {
    const idx = opts.reorder ? queue.length - 1 : 0;
    const item = queue.splice(idx, 1)[0]!;
    const outs = advance(item.to, { k: 'inbound', msg: item.msg });
    if (opts.duplicate) advance(item.to, { k: 'inbound', msg: item.msg }); // replay — must be a no-op
    const other = item.to === A ? B : A;
    enqueue(other, outs);
  }

  return { a: A.driver.terminalState(), b: B.driver.terminalState() };
}
