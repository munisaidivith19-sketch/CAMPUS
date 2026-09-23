/**
 * Rule-based discovery.
 *
 * The requirement is that suggestions are DETERMINISTIC and explainable — no model, no scoring,
 * no AI. These tests pin the rules down and, importantly, assert that the same input always
 * produces the same output, which is the property that separates a rule from a model.
 */
import { describe, expect, it } from 'vitest';
import { matchClubReasons, type DiscoveryProfile } from '../../src/services/club.service.js';
import { matchEventReasons } from '../../src/services/event.service.js';

const profile = (overrides: Partial<DiscoveryProfile> = {}): DiscoveryProfile => ({
  interests: ['coding', 'robotics'],
  departmentId: 'dept-cse',
  joinedCategories: [],
  existingClubIds: [],
  ...overrides,
});

const club = (overrides: Partial<Parameters<typeof matchClubReasons>[1]> = {}) => ({
  id: 'club-1',
  category: 'Technology',
  interests: ['coding'],
  departmentPeerCount: 0,
  ...overrides,
});

describe('club discovery rules', () => {
  it('matches on a shared interest and says which one', () => {
    const reasons = matchClubReasons(profile(), club());
    expect(reasons).toContain('Matches your interest in coding');
  });

  it('lists every shared interest, not just the first', () => {
    const reasons = matchClubReasons(profile(), club({ interests: ['coding', 'robotics'] }));
    expect(reasons).toContain('Matches your interest in coding');
    expect(reasons).toContain('Matches your interest in robotics');
  });

  it('returns nothing when nothing matches', () => {
    expect(matchClubReasons(profile({ interests: ['music'] }), club())).toEqual([]);
  });

  it('never suggests a club the student already has a membership row for', () => {
    const reasons = matchClubReasons(
      profile({ existingClubIds: ['club-1'] }),
      club({ interests: ['coding', 'robotics'], departmentPeerCount: 10 }),
    );
    // Even with every other signal firing, an existing membership suppresses the suggestion.
    expect(reasons).toEqual([]);
  });

  it('matches on a category the student already joined', () => {
    const reasons = matchClubReasons(
      profile({ interests: [], joinedCategories: ['Technology'] }),
      club(),
    );
    expect(reasons).toContain('Similar to Technology clubs you already joined');
  });

  it('requires at least two department peers before citing them', () => {
    expect(matchClubReasons(profile({ interests: [] }), club({ departmentPeerCount: 1 }))).toEqual([]);

    const reasons = matchClubReasons(profile({ interests: [] }), club({ departmentPeerCount: 2 }));
    expect(reasons).toContain('2 students from your department are members');
  });

  it('does not cite department peers for a student with no department', () => {
    const reasons = matchClubReasons(
      profile({ interests: [], departmentId: null }),
      club({ departmentPeerCount: 5 }),
    );
    expect(reasons).toEqual([]);
  });

  it('is deterministic — same input, same output, every time', () => {
    const input = [profile({ joinedCategories: ['Technology'] }), club({ interests: ['robotics', 'coding'], departmentPeerCount: 4 })] as const;
    const first = matchClubReasons(input[0], input[1]);

    for (let i = 0; i < 20; i += 1) {
      expect(matchClubReasons(input[0], input[1])).toEqual(first);
    }
  });

  it('orders shared-interest reasons stably regardless of input order', () => {
    const a = matchClubReasons(profile(), club({ interests: ['coding', 'robotics'] }));
    const b = matchClubReasons(profile(), club({ interests: ['robotics', 'coding'] }));
    expect(a).toEqual(b);
  });
});

describe('event recommendation rules', () => {
  const attendee = { interests: ['technology', 'music'], clubIds: ['club-1'] };

  it('matches an event category against a declared interest', () => {
    const reasons = matchEventReasons(attendee, { category: 'Technology', clubId: null });
    expect(reasons).toContain('Matches your interest in technology');
  });

  it('matches an event hosted by a club the student belongs to', () => {
    const reasons = matchEventReasons(attendee, { category: 'Sports', clubId: 'club-1' });
    expect(reasons).toEqual(['Hosted by a club you belong to']);
  });

  it('can match on both signals at once', () => {
    const reasons = matchEventReasons(attendee, { category: 'Music', clubId: 'club-1' });
    expect(reasons).toHaveLength(2);
  });

  it('returns nothing for an unrelated event', () => {
    expect(matchEventReasons(attendee, { category: 'Debate', clubId: 'club-9' })).toEqual([]);
  });

  it('is deterministic', () => {
    const first = matchEventReasons(attendee, { category: 'Music', clubId: 'club-1' });
    for (let i = 0; i < 20; i += 1) {
      expect(matchEventReasons(attendee, { category: 'Music', clubId: 'club-1' })).toEqual(first);
    }
  });
});
