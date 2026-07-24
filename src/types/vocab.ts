/**
 * The one controlled vocabulary for the guided persona builder.
 *
 * The interview guide (spec/11-persona-interview.md), the web-app prompts, the
 * MCP `kinweave_save_persona` schema, `validateDraft`, and the venue table all
 * MUST agree on these values. They used to be re-spelled in each place and had
 * already drifted (e.g. a stray `nightlife` that no venue supported). Import
 * them from here so the vocabulary can only be changed in one spot; the
 * vocab-parity test (test/vocab.test.ts) fails if any consumer diverges.
 */

/** Coarse activity classes. Each one keys into a neutral public venue (src/core/venues.ts). */
export const ACTIVITY_CLASSES = ['games', 'food', 'outdoors', 'arts', 'sport', 'learning'] as const;
export type ActivityClass = (typeof ACTIVITY_CLASSES)[number];

/**
 * Coarse availability bands. Order is significant: index i is bit i of the
 * 4-bit `availabilityMask` (weekday_day = bit 0 … weekend_eve = bit 3).
 */
export const TIME_BANDS = ['weekday_day', 'weekday_eve', 'weekend_day', 'weekend_eve'] as const;
export type TimeBand = (typeof TIME_BANDS)[number];

export const GROUP_PREFS = ['one_on_one', 'small', 'either'] as const;
export type GroupPref = (typeof GROUP_PREFS)[number];

export const ENERGY_LEVELS = ['low', 'medium', 'high'] as const;
export type EnergyLevel = (typeof ENERGY_LEVELS)[number];

export const SETTING_PREFS = ['public_venue', 'outdoor', 'either'] as const;
export type SettingPref = (typeof SETTING_PREFS)[number];

export const NOVELTY_PREFS = ['familiar', 'new', 'either'] as const;
export type NoveltyPref = (typeof NOVELTY_PREFS)[number];

const has = <T extends readonly string[]>(vocab: T, v: unknown): v is T[number] =>
  typeof v === 'string' && (vocab as readonly string[]).includes(v);

/** Keep only recognized activity classes from an untrusted array. */
export const filterActivityClasses = (v: unknown): ActivityClass[] =>
  (Array.isArray(v) ? v : []).filter((x): x is ActivityClass => has(ACTIVITY_CLASSES, x));

/** Keep only recognized time bands from an untrusted array. */
export const filterTimeBands = (v: unknown): TimeBand[] =>
  (Array.isArray(v) ? v : []).filter((x): x is TimeBand => has(TIME_BANDS, x));

/** Pick a value from a closed vocabulary, falling back to a default. */
export const oneOf = <T extends readonly string[]>(vocab: T, v: unknown, fallback: T[number]): T[number] =>
  has(vocab, v) ? v : fallback;
