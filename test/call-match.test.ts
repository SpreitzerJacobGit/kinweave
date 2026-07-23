import { describe, it, expect } from 'vitest';
import { Node } from '../src/portable/crypto';
import { matchCall } from '../src/core/call-match';
import { ava, ben, cleo } from '../src/sim/fixtures';

const CID = 'northside-climbers';
const FAR = 10_000_000;

function callFrom(over: Partial<Parameters<Node['openCall']>[0]>) {
  return new Node().openCall({
    community: CID,
    activityClass: 'games',
    timeBand: 'weekend_day',
    geoCell: 'northside',
    groupSize: 'one_on_one',
    expiry: FAR,
    nonce: 'n1',
    ...over,
  });
}

describe('matchCall', () => {
  it('surfaces a strongly compatible call (shared activity + schedule + geo + group)', () => {
    // Ben's intent, scored against Ava's profile.
    const bensCall = callFrom({ activityClass: 'games', timeBand: 'weekend_day', geoCell: 'northside', groupSize: 'one_on_one' });
    const m = matchCall(bensCall, ava);
    expect(m).not.toBeNull();
    expect(m!.scheduleFit).toBe(true);
    expect(m!.geoFit).toBe(true);
    expect(m!.groupFit).toBe(true);
    expect(m!.sharedActivities).toContain('games');
    expect(m!.band).toBe('high');
  });

  it('filters out a call with nothing in common (Cleo vs Ava)', () => {
    const cleosCall = callFrom({ activityClass: 'nightlife', timeBand: 'weekday_eve', geoCell: 'downtown', groupSize: 'small' });
    expect(matchCall(cleosCall, ava)).toBeNull();
  });

  it('surfaces a partial match but records the frictions honestly', () => {
    // Shared activity + geo, but a time band Ava does not keep free.
    const call = callFrom({ activityClass: 'games', timeBand: 'weekday_day', geoCell: 'northside', groupSize: 'one_on_one' });
    const m = matchCall(call, ava);
    expect(m).not.toBeNull();
    expect(m!.scheduleFit).toBe(false);
    expect(m!.reasons.join(' ')).toMatch(/busy on weekday_day/);
  });

  it('flags a group-size friction', () => {
    const call = callFrom({ activityClass: 'games', groupSize: 'small' }); // Ava prefers one_on_one
    const m = matchCall(call, ava);
    expect(m).not.toBeNull();
    expect(m!.groupFit).toBe(false);
    expect(m!.reasons.join(' ')).toMatch(/group size small vs prefers one_on_one/);
  });

  it('matches symmetrically for the compatible pair (Ava-intent vs Ben)', () => {
    const avasCall = callFrom({ activityClass: 'games', timeBand: 'weekend_day', geoCell: 'northside', groupSize: 'one_on_one' });
    const m = matchCall(avasCall, ben);
    expect(m).not.toBeNull();
    expect(m!.band).toBe('high');
  });
});
