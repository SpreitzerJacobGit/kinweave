import { describe, it, expect } from 'vitest';
import { Node, type OpenCall } from '../src/portable/crypto';
import { StandingIntentBook, digestCalls, intentCovers, type StandingIntent } from '../src/portable/standing-intents';
import { ava } from '../src/sim/fixtures';

const CID = 'northside-climbers';
const NOW = 1000;
const FAR = 10_000_000;

function call(over: Partial<Parameters<Node['openCall']>[0]> = {}): OpenCall {
  return new Node().openCall({
    community: CID,
    activityClass: 'games',
    timeBand: 'weekend_day',
    geoCell: 'northside',
    groupSize: 'one_on_one',
    expiry: FAR,
    nonce: 'n',
    ...over,
  });
}

const gamesWeekends: StandingIntent = {
  id: 'si-games',
  activityClasses: ['games'],
  timeBands: ['weekend_day', 'weekend_eve'],
  geoCells: ['northside'],
  groupSize: 'any',
  until: FAR,
};

describe('intentCovers', () => {
  it('covers a call inside the declared scope', () => {
    expect(intentCovers(gamesWeekends, call(), NOW)).toBe(true);
  });
  it('rejects a call outside the time-band scope', () => {
    expect(intentCovers(gamesWeekends, call({ timeBand: 'weekday_eve' }), NOW)).toBe(false);
  });
  it('rejects a call outside the activity scope', () => {
    expect(intentCovers(gamesWeekends, call({ activityClass: 'nightlife' }), NOW)).toBe(false);
  });
  it('treats an expired standing intent as inert', () => {
    expect(intentCovers({ ...gamesWeekends, until: 500 }, call(), NOW)).toBe(false);
  });
  it('empty scope arrays mean "any"', () => {
    const anyIntent: StandingIntent = { id: 'any', activityClasses: [], timeBands: [], geoCells: [], groupSize: 'any', until: FAR };
    expect(intentCovers(anyIntent, call({ activityClass: 'anything' }), NOW)).toBe(true);
  });
});

describe('digestCalls', () => {
  it('surfaces a covered, profile-matching call', () => {
    const d = digestCalls([gamesWeekends], [call()], ava, { now: NOW });
    expect(d).toHaveLength(1);
    expect(d[0]!.intentId).toBe('si-games');
    expect(d[0]!.match.band).toBe('high');
  });

  it('drops calls no standing intent covers', () => {
    const d = digestCalls([gamesWeekends], [call({ activityClass: 'nightlife', geoCell: 'downtown', timeBand: 'weekday_eve' })], ava, { now: NOW });
    expect(d).toHaveLength(0);
  });

  it('dedups by caller and ranks high bands first', () => {
    const strong = call({ nonce: 'strong' }); // full match → high
    const weak = call({ nonce: 'weak', groupSize: 'small' }); // group friction → lower
    const d = digestCalls([gamesWeekends], [weak, strong], ava, { now: NOW });
    expect(d.map((c) => c.call.pubKey)).toEqual([strong.pubKey, weak.pubKey]);
  });

  it('caps the number of surfaced candidates (anti-spiral)', () => {
    const calls = Array.from({ length: 8 }, (_, i) => call({ nonce: `c${i}` }));
    const d = digestCalls([gamesWeekends], calls, ava, { now: NOW, maxCandidates: 3 });
    expect(d).toHaveLength(3);
  });

  it('honors the exclude hook (blocked / cooled-down callers)', () => {
    const blocked = call({ nonce: 'blocked' });
    const ok = call({ nonce: 'ok' });
    const d = digestCalls([gamesWeekends], [blocked, ok], ava, { now: NOW, exclude: (c) => c.pubKey === blocked.pubKey });
    expect(d.map((c) => c.call.pubKey)).toEqual([ok.pubKey]);
  });

  it('skips self-expired calls', () => {
    const d = digestCalls([gamesWeekends], [call({ expiry: 500 })], ava, { now: NOW });
    expect(d).toHaveLength(0);
  });
});

describe('StandingIntentBook', () => {
  it('adds, replaces by id, removes, and round-trips through JSON', () => {
    const book = new StandingIntentBook();
    book.add(gamesWeekends);
    book.add({ ...gamesWeekends, geoCells: ['downtown'] }); // replace by id
    expect(book.list()).toHaveLength(1);
    expect(book.list()[0]!.geoCells).toEqual(['downtown']);

    const round = StandingIntentBook.fromJSON(book.toJSON());
    expect(round.list()).toEqual(book.list());

    book.remove('si-games');
    expect(book.list()).toHaveLength(0);
  });

  it('digest() delegates against the book contents', () => {
    const book = new StandingIntentBook([gamesWeekends]);
    expect(book.digest([call()], ava, { now: NOW })).toHaveLength(1);
  });
});
