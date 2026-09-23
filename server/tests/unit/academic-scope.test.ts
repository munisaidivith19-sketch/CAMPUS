/**
 * The academic scope rules: who may see academic data about whom.
 *
 * These are the second half of the authorization pipeline — the permission layer says whether a
 * role may read attendance at all, and these rules say *whose*. Tested pure, without a database,
 * so every branch is covered cheaply.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_SCOPE,
  canViewStudent,
  createScope,
  isEmptyScope,
  mergeScopes,
  sameSection,
  type ScopedStudent,
} from '../../src/policies/academicScope.js';

const student = (overrides: Partial<ScopedStudent> = {}): ScopedStudent => ({
  userId: 'student-1',
  departmentId: 'dept-cse',
  batch: '2022-2026',
  section: 'A',
  ...overrides,
});

describe('empty scope', () => {
  it('grants nothing — the fail-closed default', () => {
    expect(isEmptyScope(EMPTY_SCOPE)).toBe(true);
    expect(canViewStudent(EMPTY_SCOPE, student())).toBe(false);
  });

  it('is what a mentor with no assigned section gets', () => {
    // A CLASS_MENTOR whose profile has no mentorOf must not fall back to "everyone".
    const unassignedMentor = createScope({ classIds: [] });
    expect(canViewStudent(unassignedMentor, student())).toBe(false);
  });
});

describe('student scope', () => {
  it('sees only themselves', () => {
    const scope = createScope({ selfUserId: 'student-1' });
    expect(canViewStudent(scope, student())).toBe(true);
    expect(canViewStudent(scope, student({ userId: 'student-2' }))).toBe(false);
  });

  it('does not leak to a classmate in the same section', () => {
    const scope = createScope({ selfUserId: 'student-1' });
    expect(canViewStudent(scope, student({ userId: 'classmate', section: 'A' }))).toBe(false);
  });
});

describe('mentor scope (a section)', () => {
  const scope = createScope({ sections: [{ batch: '2022-2026', section: 'A' }] });

  it('sees every student in that section', () => {
    expect(canViewStudent(scope, student({ userId: 'anyone' }))).toBe(true);
  });

  it('does not see another section', () => {
    expect(canViewStudent(scope, student({ section: 'B' }))).toBe(false);
  });

  it('does not see another batch in the same section letter', () => {
    expect(canViewStudent(scope, student({ batch: '2023-2027' }))).toBe(false);
  });

  it('matches section letters case-insensitively', () => {
    expect(canViewStudent(scope, student({ section: 'a' }))).toBe(true);
  });

  it('does not match a student with no section recorded', () => {
    expect(canViewStudent(scope, student({ section: null }))).toBe(false);
  });
});

describe('HOD scope (a department)', () => {
  const scope = createScope({ departmentIds: ['dept-cse'] });

  it('sees students in their department regardless of section', () => {
    expect(canViewStudent(scope, student({ section: 'C' }))).toBe(true);
  });

  it('does not see another department', () => {
    expect(canViewStudent(scope, student({ departmentId: 'dept-ece' }))).toBe(false);
  });

  it('does not match a student with no department recorded', () => {
    expect(canViewStudent(scope, student({ departmentId: null }))).toBe(false);
  });
});

describe('institution-wide scope', () => {
  const scope = createScope({ institutionWide: true });

  it('sees every student in the tenant', () => {
    expect(canViewStudent(scope, student({ departmentId: 'anything', section: 'Z' }))).toBe(true);
  });

  it('still applies to students with missing profile fields', () => {
    expect(canViewStudent(scope, student({ departmentId: null, batch: null, section: null }))).toBe(true);
  });
});

describe('merging scopes', () => {
  it('unions grants — an HOD who also teaches keeps both', () => {
    const merged = mergeScopes(
      createScope({ departmentIds: ['dept-cse'] }),
      createScope({ classIds: ['class-1'] }),
    );

    expect(merged.departmentIds).toEqual(['dept-cse']);
    expect(merged.classIds).toEqual(['class-1']);
  });

  it('lets institution-wide win', () => {
    const merged = mergeScopes(createScope({}), createScope({ institutionWide: true }));
    expect(merged.institutionWide).toBe(true);
  });

  it('deduplicates repeated ids and sections', () => {
    const merged = mergeScopes(
      createScope({ departmentIds: ['d1'], sections: [{ batch: 'b', section: 'A' }] }),
      createScope({ departmentIds: ['d1'], sections: [{ batch: 'b', section: 'a' }] }),
    );

    expect(merged.departmentIds).toEqual(['d1']);
    expect(merged.sections).toHaveLength(1);
  });

  it('keeps the self grant from either side', () => {
    expect(mergeScopes(createScope({ selfUserId: 'u1' }), createScope({})).selfUserId).toBe('u1');
    expect(mergeScopes(createScope({}), createScope({ selfUserId: 'u2' })).selfUserId).toBe('u2');
  });
});

describe('sameSection', () => {
  it('compares batch and section, ignoring section case', () => {
    expect(sameSection({ batch: 'b', section: 'A' }, { batch: 'b', section: 'a' })).toBe(true);
    expect(sameSection({ batch: 'b', section: 'A' }, { batch: 'c', section: 'A' })).toBe(false);
  });
});
