import { describe, it, expect } from 'vitest';
import { negotiate, DEFAULT_CAPS, CommitBook } from '../src/core/state-machine';
import { makePair, ava, ben, cleo } from '../src/sim/fixtures';
import { approveAll, denyGate, deferGate } from '../src/persona/owner';
import type { PrivateProfile } from '../src/types/profile';

describe('happy path (compatible pair)', () => {
  const [a, b] = makePair(ava, ben, approveAll, approveAll);
  const res = negotiate(a, b);

  it('reaches a committed hangout through S0..S8', () => {
    expect(res.outcome).toBe('committed');
    expect(res.stagesTraversed).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    expect(res.artifact?.status).toBe('committed');
  });

  it('produces an honest rationale that surfaces caveats', () => {
    const r = res.artifact!.compatibilityRationale;
    expect(r.honestCaveats.length).toBeGreaterThan(0);
    expect(r.overallConfidence).toBeGreaterThan(0);
    expect(r.overallConfidence).toBeLessThanOrEqual(1);
  });

  it('keeps the meetup public and never derived from a home coordinate', () => {
    expect(res.artifact!.plan.place.isPublic).toBe(true);
  });
});

describe('graceful abandon codes are reachable', () => {
  const cases: { name: string; setup: () => ReturnType<typeof negotiate>; expected: string }[] = [
    {
      name: 'low_match (incompatible interests)',
      setup: () => negotiate(...makePair(ava, cleo, approveAll, approveAll)),
      expected: 'low_match',
    },
    {
      name: 'declined (G1 denied)',
      setup: () => negotiate(...makePair(ava, ben, approveAll, denyGate('G1'))),
      expected: 'declined',
    },
    {
      name: 'timeout (G1 deferred)',
      setup: () => negotiate(...makePair(ava, ben, approveAll, deferGate('G1'))),
      expected: 'timeout',
    },
    {
      name: 'disclosure_refused (G2 denied)',
      setup: () => negotiate(...makePair(ava, ben, approveAll, denyGate('G2'))),
      expected: 'disclosure_refused',
    },
    {
      name: 'owner_declined (G4 denied)',
      setup: () => negotiate(...makePair(ava, ben, approveAll, denyGate('G4'))),
      expected: 'owner_declined',
    },
    {
      name: 'owner_timeout (G4 deferred)',
      setup: () => negotiate(...makePair(ava, ben, approveAll, deferGate('G4'))),
      expected: 'owner_timeout',
    },
    {
      name: 'no_feasible_plan (both sides picky, coplan cap exhausted)',
      setup: () => negotiate(...makePair(ava, ben, approveAll, approveAll, { pickyPlanner: true }, { pickyPlanner: true })),
      expected: 'no_feasible_plan',
    },
    {
      name: 'commit_failed (a party never confirms)',
      setup: () => negotiate(...makePair(ava, ben, approveAll, approveAll, {}, { failCommit: true })),
      expected: 'commit_failed',
    },
    {
      name: 'budget_exhausted (tiny message budget)',
      setup: () => negotiate(...makePair(ava, ben, approveAll, approveAll), { ...DEFAULT_CAPS, messageBudget: 5 }),
      expected: 'budget_exhausted',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const res = c.setup();
      expect(res.outcome).toBe('abandoned');
      expect(res.code).toBe(c.expected);
    });
  }

  it('archetype_mismatch (same interests, disjoint activities)', () => {
    // Matches on interest vector + hobby tags (passes S2) but has no shared
    // activity class or time band (fails S3).
    const twin: PrivateProfile = {
      ...ben,
      ownerId: 'owner-dax',
      handle: 'dax',
      firstName: 'Dax',
      legalName: 'Dax Rowe',
      activityClasses: ['nightlife'],
      timeBands: ['weekday_eve'],
    };
    const res = negotiate(...makePair(ava, twin, approveAll, approveAll));
    expect(res.outcome).toBe('abandoned');
    expect(res.code).toBe('archetype_mismatch');
  });
});

describe('abandon leaks no true reason to the counterpart', () => {
  it('sends only a face-saving public reason on the wire', () => {
    const res = negotiate(...makePair(ava, cleo, approveAll, approveAll));
    const abandonMsg = res.channel.transcript().find((m) => m.type === 'ABANDON')!;
    expect(abandonMsg.payload.publicReason).toBeTruthy();
    // The true reason is owner-side only, never in the wire payload.
    expect(JSON.stringify(abandonMsg.payload)).not.toContain(res.trueReason);
  });
});

describe('two-phase commit is idempotent', () => {
  it('a duplicate confirm on the same artifact hash does not double-book', () => {
    const book = new CommitBook();
    expect(book.confirm('vABC')).toBe('committed');
    expect(book.confirm('vABC')).toBe('duplicate');
    expect(book.size()).toBe(1);
  });
});
