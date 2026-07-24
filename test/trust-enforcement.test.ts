import { describe, it, expect } from 'vitest';
import { NegotiationDriver } from '../src/core/negotiation-driver';
import { DEFAULT_CAPS } from '../src/core/negotiation-core';
import { makePair, ava, ben } from '../src/sim/fixtures';
import { approveAll } from '../src/persona/owner';
import { Identity } from '../src/portable/crypto';
import { mintCommunity } from '../src/portable/community';
import { makeConnectGate } from '../src/portable/community-gate';
import { mintCoPresencePair } from '../src/portable/co-presence';
import type { Attestation } from '../src/types/attestation';
import type { Message } from '../src/types/envelope';

const NOW = 1_700_000_000_000;

/** An initiator HELLO carrying `bundle` (and declaring `subject`) in the sealed payload. */
function helloWith(bundle: Attestation[], subject = 'kw_joiner'): Message {
  const [pa, pb] = makePair(ava, ben, approveAll, approveAll);
  const driverA = new NegotiationDriver(pa, pb.ownerId, 'initiator', 'neg', DEFAULT_CAPS, { selfAttestations: bundle, selfSubject: subject });
  const out = driverA.run({ k: 'start' });
  return out.outbound.find((m) => m.type === 'HELLO')!;
}

function responder(gate?: (subjectFp: string, b: Attestation[]) => boolean) {
  const [, pb] = makePair(ava, ben, approveAll, approveAll);
  return new NegotiationDriver(pb, ava.ownerId, 'responder', 'neg', DEFAULT_CAPS, gate ? { connectGate: gate } : {});
}

describe('community trust enforcement in the negotiation driver', () => {
  it('attaches the self bundle + declared identity to the outbound HELLO', () => {
    const coP = mintCoPresencePair(Identity.generate(), Identity.generate(), { rt: 'r', coarseTime: NOW }).forA;
    const hello = helloWith([coP], 'kw_me');
    expect(hello.payload.attestations).toEqual([coP]);
    expect(hello.payload.subject).toBe('kw_me');
  });

  it('abandons with policy_unmet BEFORE G1 when the gate rejects', () => {
    const out = responder(() => false).run({ k: 'inbound', msg: helloWith([]) });
    expect(out.terminal?.outcome).toBe('abandoned');
    expect(out.terminal?.code).toBe('policy_unmet');
    expect(out.gateRequest).toBeUndefined(); // never reached G1
  });

  it('proceeds to G1 when a REAL gate is satisfied', () => {
    const joiner = Identity.generate();
    const host = Identity.generate();
    const { forA } = mintCoPresencePair(joiner, host, { rt: 'r', coarseTime: NOW });
    const { descriptor } = mintCommunity({ name: 'C', policy: { require: 'co-presence' } });
    const gate = makeConnectGate(descriptor, { now: NOW });

    const out = responder(gate).run({ k: 'inbound', msg: helloWith([forA], joiner.id) });
    expect(out.terminal).toBeUndefined();
    expect(out.outbound.some((m) => m.type === 'HELLO_ACK')).toBe(true);
    expect(out.gateRequest?.gate).toBe('G1');
  });

  it('a real gate rejects an empty bundle (policy_unmet)', () => {
    const { descriptor } = mintCommunity({ name: 'C', policy: { require: 'co-presence' } });
    const gate = makeConnectGate(descriptor, { now: NOW });
    const out = responder(gate).run({ k: 'inbound', msg: helloWith([], Identity.generate().id) });
    expect(out.terminal?.code).toBe('policy_unmet');
  });

  it('no trust wiring → unchanged: a normal HELLO reaches G1', () => {
    const out = responder().run({ k: 'inbound', msg: helloWith([]) });
    expect(out.terminal).toBeUndefined();
    expect(out.gateRequest?.gate).toBe('G1');
  });
});
