import { describe, it, expect } from 'vitest';
import { ACTIVITY_CLASSES, TIME_BANDS } from '../src/types/vocab';
import { NEUTRAL_VENUES, venueFor } from '../src/core/venues';
import { validateDraft } from '../src/ai/onboarding';
import { EXTRACT_SYSTEM, ONBOARDING_SYSTEM } from '../src/ai/prompts';

// The controlled vocabulary lives in one place (src/types/vocab.ts). These tests
// fail if any consumer drifts from it — the exact failure that shipped `nightlife`
// into the extractor while no venue supported it.
describe('controlled vocabulary is single-sourced and every consumer agrees', () => {
  it('every activity class maps to a real (non-fallback) neutral venue', () => {
    for (const cls of ACTIVITY_CLASSES) {
      expect(NEUTRAL_VENUES[cls], `no venue for "${cls}"`).toBeTruthy();
      // A known class must not fall through to the generic fallback.
      expect(venueFor(cls)).toBe(NEUTRAL_VENUES[cls]);
    }
  });

  it('validateDraft keeps known activity classes / time bands and drops unknown ones', () => {
    const draft = validateDraft({
      handle: 'x',
      activityClasses: [...ACTIVITY_CLASSES, 'nightlife', 'bogus'],
      timeBands: [...TIME_BANDS, 'graveyard_shift'],
    });
    expect(draft.activityClasses).toEqual([...ACTIVITY_CLASSES]);
    expect(draft.timeBands).toEqual([...TIME_BANDS]);
  });

  it('the extractor prompt lists exactly the activity vocabulary — no stray values', () => {
    for (const cls of ACTIVITY_CLASSES) expect(EXTRACT_SYSTEM).toContain(cls);
    // The historical drift: nightlife was listed but unsupported downstream.
    expect(EXTRACT_SYSTEM).not.toContain('nightlife');
    for (const band of TIME_BANDS) expect(EXTRACT_SYSTEM).toContain(band);
  });

  it('the onboarding prompt steers toward the same activity vocabulary', () => {
    for (const cls of ACTIVITY_CLASSES) expect(ONBOARDING_SYSTEM).toContain(cls);
  });
});
