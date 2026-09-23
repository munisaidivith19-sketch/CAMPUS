/**
 * Academic scope — who a caller may see academic data about.
 *
 * Phase 2's permission layer answers "may this role do X at all?". It cannot answer "which
 * students?", because that depends on assignments stored in the database. This module is that
 * second half, kept pure so the rules are unit-testable without a database:
 *
 *     student       → themselves
 *     faculty       → the classes they teach
 *     class mentor  → their section (every subject) + classes they teach
 *     HOD           → their department + classes they teach
 *     principal     → the whole college
 *     system admin  → the whole college
 *
 * A scope is a UNION of grants, not a single level, because these roles overlap in practice — an
 * HOD usually also teaches. An empty scope grants nothing, which is the fail-closed default for
 * a role that holds the permission but has no assignment backing it.
 */

export interface SectionRef {
  batch: string;
  section: string;
}

export interface AcademicScope {
  /** Unrestricted within the tenant (principal / system admin). Never across tenants. */
  institutionWide: boolean;
  departmentIds: string[];
  sections: SectionRef[];
  classIds: string[];
  /** Present for a student: they may always see their own records. */
  selfUserId: string | null;
}

export const EMPTY_SCOPE: AcademicScope = {
  institutionWide: false,
  departmentIds: [],
  sections: [],
  classIds: [],
  selfUserId: null,
};

export function createScope(partial: Partial<AcademicScope>): AcademicScope {
  return { ...EMPTY_SCOPE, ...partial };
}

/** True when the scope grants nothing at all — the caller can see no academic records. */
export function isEmptyScope(scope: AcademicScope): boolean {
  return (
    !scope.institutionWide &&
    scope.departmentIds.length === 0 &&
    scope.sections.length === 0 &&
    scope.classIds.length === 0 &&
    scope.selfUserId === null
  );
}

export function sameSection(a: SectionRef, b: SectionRef): boolean {
  return a.batch === b.batch && a.section.toUpperCase() === b.section.toUpperCase();
}

/** The shape of a student this scope is being tested against. */
export interface ScopedStudent {
  userId: string;
  departmentId: string | null;
  batch: string | null;
  section: string | null;
}

/**
 * May the holder of `scope` see this student's academic records?
 *
 * Class-level grants are deliberately NOT decided here: a class grant means "the rows for that
 * class", which is a filter on attendance rows rather than a fact about the student. Callers
 * that work row-by-row use `visibleClassIds` alongside this.
 */
export function canViewStudent(scope: AcademicScope, student: ScopedStudent): boolean {
  if (scope.institutionWide) return true;
  if (scope.selfUserId && scope.selfUserId === student.userId) return true;

  if (student.departmentId && scope.departmentIds.includes(student.departmentId)) return true;

  if (student.batch && student.section) {
    const ref = { batch: student.batch, section: student.section };
    if (scope.sections.some((owned) => sameSection(owned, ref))) return true;
  }

  return false;
}

/** Merge two scopes into their union (used where a caller holds several roles). */
export function mergeScopes(a: AcademicScope, b: AcademicScope): AcademicScope {
  return {
    institutionWide: a.institutionWide || b.institutionWide,
    departmentIds: [...new Set([...a.departmentIds, ...b.departmentIds])],
    sections: [
      ...a.sections,
      ...b.sections.filter((candidate) => !a.sections.some((owned) => sameSection(owned, candidate))),
    ],
    classIds: [...new Set([...a.classIds, ...b.classIds])],
    selfUserId: a.selfUserId ?? b.selfUserId,
  };
}
