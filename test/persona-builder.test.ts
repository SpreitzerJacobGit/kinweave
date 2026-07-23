import { describe, it, expect } from 'vitest';
import { assembleProfile, validateDraft } from '../src/ai/onboarding';
import type { ProfileSecrets } from '../src/ai/types';

// The guided persona builder produces a portable ProfileDraft; identity secrets
// are added on-device and are OPTIONAL (empty until the owner chooses to add
// them). This is the "AI read the repo → wrote a draft → we adopt it" handoff.
describe('guided persona builder: draft → profile handoff', () => {
  const emptySecrets: ProfileSecrets = { ownerId: 'owner-1', firstName: '', legalName: '', homeCoordinate: { lat: 0, lng: 0 }, contact: '' };

  it('a draft with no identity fields still assembles into a valid Persona', () => {
    const draft = validateDraft({
      handle: 'trailmix',
      community: 'northside',
      hobbyTags: ['hiking', 'photography'],
      geoCell: 'northside',
      valueTags: ['outdoorsy'],
      availabilityMask: 12,
      groupPref: 'small',
      activityClasses: ['outdoors', 'arts'],
      energyLevel: 'medium',
      timeBands: ['weekend_day'],
      settingPref: 'outdoor',
      hardConstraints: [],
      noveltyPref: 'new',
    });
    const profile = assembleProfile(draft, emptySecrets);
    expect(profile.firstName).toBe('');
    expect(profile.contact).toBe('');
    expect(profile.legalName).toBe('');
    // matching still works: the interest vector is derived on-device from tags.
    expect(profile.interestVector).toHaveLength(5);
    expect(profile.hobbyTags).toEqual(['hiking', 'photography']);
  });

  it('the public handle is sourced from the draft, never from the real first name', () => {
    const draft = validateDraft({ handle: 'trailmix', hobbyTags: ['hiking'] });
    const profile = assembleProfile(draft, { ...emptySecrets, firstName: 'Dana', legalName: 'Dana Q. Public' });
    // handle (public, T0) comes from the draft; the real name stays a private secret.
    expect(profile.handle).toBe('trailmix');
    expect(profile.handle).not.toBe(profile.firstName);
    expect(profile.handle).not.toContain('Dana');
  });

  it('a draft parsed from JSON (the file/paste handoff) round-trips through validateDraft', () => {
    const json = '{"handle":"q","hobbyTags":["chess"],"activityClasses":["games"],"timeBands":["weekday_eve"]}';
    const draft = validateDraft(JSON.parse(json));
    expect(draft.activityClasses).toEqual(['games']);
    expect(draft.timeBands).toEqual(['weekday_eve']);
    expect(() => assembleProfile(draft, emptySecrets)).not.toThrow();
  });
});
