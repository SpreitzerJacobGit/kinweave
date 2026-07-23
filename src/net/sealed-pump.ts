/**
 * Drive two NegotiationDrivers end-to-end over the SEALED transport: every
 * protocol Message is JSON-serialized, X25519+AES-GCM sealed to the counterpart,
 * signature-checked by the (untrusted) relay hub, then opened by the recipient.
 * Proves the crypto + transport + driver integrate — the relay only ever holds
 * ciphertext. Deterministic (synchronous drain), so usable in tests. See spec/08.
 */

import type { Message } from '../types/envelope';
import type { DriverTerminal } from '../types/negotiation';
import type { Persona } from '../persona/persona';
import type { NegotiationDriver } from '../core/negotiation-driver';
import type { P2PNode } from '../core/node';
import type { InMemoryRelayHub } from './peer-transport';

export interface SealedSide {
  driver: NegotiationDriver;
  persona: Persona;
  node: P2PNode;
  peer: { pubKey: string; encPubKey: string }; // the counterpart's keys (from discovery/QR)
}

type Event = Parameters<NegotiationDriver['run']>[0];

function advance(side: SealedSide, event: Event): Message[] {
  let out = side.driver.run(event);
  const outbound = [...out.outbound];
  let g = 0;
  while (out.gateRequest && !out.terminal && g++ < 50) {
    const decision = side.persona.decideGate(out.gateRequest);
    out = side.driver.run({ k: 'gateResult', decision });
    outbound.push(...out.outbound);
  }
  return outbound;
}

export function pumpSealed(A: SealedSide, B: SealedSide, hub: InMemoryRelayHub): { a: DriverTerminal | null; b: DriverTerminal | null; rejected: number } {
  let rejected = 0;
  const queue: { to: SealedSide; msg: Message }[] = [];

  const route = (from: SealedSide, to: SealedSide, msgs: Message[]) => {
    for (const m of msgs) {
      const env = from.node.seal({ pubKey: from.peer.pubKey, encPubKey: from.peer.encPubKey }, JSON.stringify(m));
      if (!hub.send(env).accepted) {
        rejected += 1;
        continue;
      }
      const pt = to.node.open(env);
      if (pt === null) continue;
      queue.push({ to, msg: JSON.parse(pt) as Message });
    }
  };

  route(A, B, advance(A, { k: 'start' }));
  route(B, A, advance(B, { k: 'start' }));

  let guard = 0;
  while (queue.length && guard++ < 2000) {
    const item = queue.shift()!;
    const outs = advance(item.to, { k: 'inbound', msg: item.msg });
    route(item.to, item.to === A ? B : A, outs);
  }

  return { a: A.driver.terminalState(), b: B.driver.terminalState(), rejected };
}
