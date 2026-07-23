import { describe, it, expect } from 'vitest';
import { negotiate } from '../src/core/state-machine';
import { NegotiationDriver } from '../src/core/negotiation-driver';
import { pumpLocal, type Side } from '../src/core/negotiation-pump';
import { makePair, ava, ben, cleo } from '../src/sim/fixtures';
import { approveAll, denyGate, deferGate, type OwnerPolicy } from '../src/persona/owner';
import type { Persona } from '../src/persona/persona';
import type { PrivateProfile } from '../src/types/profile';

function sides(a: Persona, b: Persona): { A: Side; B: Side } {
  return {
    A: { driver: new NegotiationDriver(a, b.ownerId, 'initiator'), persona: a },
    B: { driver: new NegotiationDriver(b, a.ownerId, 'responder'), persona: b },
  };
}

const twin: PrivateProfile = {
  ...ben,
  ownerId: 'owner-dax',
  handle: 'dax',
  firstName: 'Dax',
  legalName: 'Dax Rowe',
  activityClasses: ['nightlife'],
  timeBands: ['weekday_eve'],
};

interface Scenario {
  name: string;
  pair: () => [Persona, Persona];
}

const scenarios: Scenario[] = [
  { name: 'happy compatible', pair: () => makePair(ava, ben, approveAll, approveAll) },
  { name: 'low_match', pair: () => makePair(ava, cleo, approveAll, approveAll) },
  { name: 'archetype_mismatch', pair: () => makePair(ava, twin, approveAll, approveAll) },
  { name: 'declined (G1)', pair: () => makePair(ava, ben, approveAll, denyGate('G1')) },
  { name: 'disclosure_refused (G2)', pair: () => makePair(ava, ben, approveAll, denyGate('G2')) },
  { name: 'owner_declined (G4)', pair: () => makePair(ava, ben, approveAll, denyGate('G4')) },
  { name: 'owner_timeout (G4 defer)', pair: () => makePair(ava, ben, approveAll, deferGate('G4')) },
  { name: 'no_feasible_plan (both picky)', pair: () => makePair(ava, ben, approveAll, approveAll, { pickyPlanner: true }, { pickyPlanner: true }) },
  { name: 'commit_failed', pair: () => makePair(ava, ben, approveAll, approveAll, {}, { failCommit: true }) },
];

describe('the async driver matches the synchronous reference for every scenario', () => {
  for (const s of scenarios) {
    it(s.name, () => {
      const [refA, refB] = s.pair();
      const ref = negotiate(refA, refB);

      const [a, b] = s.pair();
      const { A, B } = sides(a, b);
      const res = pumpLocal(A, B);

      // both nodes agree
      expect(res.a?.outcome).toBe(res.b?.outcome);
      // driver outcome matches the reference
      expect(res.a?.outcome).toBe(ref.outcome);
      if (ref.outcome === 'abandoned') {
        expect(res.a?.code).toBe(ref.code);
      } else {
        // committed — same binding artifact hash on both sides and vs the reference
        expect(res.a?.artifact?.versionHash).toBe(ref.artifact?.versionHash);
        expect(res.b?.artifact?.versionHash).toBe(ref.artifact?.versionHash);
      }
    });
  }
});

describe('the driver is idempotent under message reordering and duplication', () => {
  it('still commits with the same artifact hash when delivery is reordered + duplicated', () => {
    const [refA, refB] = makePair(ava, ben, approveAll, approveAll);
    const ref = negotiate(refA, refB);

    const [a, b] = makePair(ava, ben, approveAll, approveAll);
    const { A, B } = sides(a, b);
    const res = pumpLocal(A, B, { reorder: true, duplicate: true });

    expect(res.a?.outcome).toBe('committed');
    expect(res.a?.artifact?.versionHash).toBe(ref.artifact?.versionHash);
    expect(res.b?.artifact?.versionHash).toBe(ref.artifact?.versionHash);
  });
});
