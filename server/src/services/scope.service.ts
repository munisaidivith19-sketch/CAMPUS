/**
 * Resolving a caller's academic scope and announcement audience from stored assignments.
 *
 * The pure rules live in `policies/academicScope.ts`; this is the part that has to read the
 * database. Keeping them apart means the rules can be tested exhaustively without fixtures,
 * while this module stays a thin, obvious mapping from "who are you" to "what can you reach".
 *
 * Everything here is derived from the authenticated principal and the records attached to it.
 * No request field influences a scope, so a caller cannot widen their own reach by asking.
 */
import type { Principal } from '@campusconnect/security';
import { Role } from '@campusconnect/types';
import {
  createScope,
  mergeScopes,
  type AcademicScope,
  type ScopedStudent,
  canViewStudent,
} from '../policies/academicScope.js';
import { classRepository } from '../repositories/academics.repository.js';
import { departmentRepository } from '../repositories/institution.repository.js';
import {
  facultyProfileRepository,
  studentProfileRepository,
} from '../repositories/profile.repository.js';
import { clubMembershipRepository } from '../repositories/club.repository.js';
import type { AudienceContext } from '../repositories/announcement.repository.js';
import { Errors } from '../utils/errors.js';

/** Roles whose reach is the entire institution. */
const INSTITUTION_WIDE_ROLES: readonly Role[] = [Role.SYSTEM_ADMIN, Role.PRINCIPAL];

/** Roles that can hold class assignments. */
const TEACHING_ROLES: readonly Role[] = [Role.FACULTY, Role.CLASS_MENTOR, Role.HOD];

export async function resolveAcademicScope(principal: Principal): Promise<AcademicScope> {
  const { institutionId, userId, roles } = principal;

  if (roles.some((role) => INSTITUTION_WIDE_ROLES.includes(role))) {
    return createScope({ institutionWide: true });
  }

  let scope = createScope({});

  if (roles.includes(Role.STUDENT)) {
    scope = mergeScopes(scope, createScope({ selfUserId: userId }));
  }

  if (roles.includes(Role.HOD)) {
    const headed = await departmentRepository.listHeadedBy(institutionId, userId);
    const departmentIds = headed.map((department) => String(department._id));

    // Fall back to their own department if the Department record has no hodUserId set yet.
    if (departmentIds.length === 0) {
      const profile = await facultyProfileRepository.findByUserId(institutionId, userId);
      if (profile?.departmentId) departmentIds.push(String(profile.departmentId));
    }

    scope = mergeScopes(scope, createScope({ departmentIds }));
  }

  if (roles.includes(Role.CLASS_MENTOR)) {
    const profile = await facultyProfileRepository.findByUserId(institutionId, userId);
    // A mentor with no assigned section resolves to nothing extra — fail closed, not open.
    // `mentorOf` is singular by invariant (see FacultyProfile.model.ts); the scope it produces
    // is still an array because a mentor who also teaches reaches other sections' classes.
    if (profile?.mentorOf) {
      scope = mergeScopes(
        scope,
        createScope({ sections: [{ batch: profile.mentorOf.batch, section: profile.mentorOf.section }] }),
      );
    }
  }

  if (roles.some((role) => TEACHING_ROLES.includes(role))) {
    const taught = await classRepository.listTaughtBy(institutionId, userId);
    scope = mergeScopes(scope, createScope({ classIds: taught.map((klass) => String(klass._id)) }));
  }

  return scope;
}

/**
 * Flatten a scope into the set of class ids it can reach.
 *
 * Returns `null` for institution-wide callers, meaning "no class restriction". Callers MUST
 * treat `null` and `[]` differently: `[]` is an empty scope that must match nothing, and
 * collapsing the two is how a scoped query accidentally becomes an unscoped one.
 */
export async function resolveVisibleClassIds(
  institutionId: string,
  scope: AcademicScope,
): Promise<string[] | null> {
  if (scope.institutionWide) return null;

  const ids = new Set<string>(scope.classIds);

  if (scope.sections.length > 0) {
    const classes = await classRepository.listInSections(institutionId, scope.sections);
    for (const klass of classes) ids.add(String(klass._id));
  }

  if (scope.departmentIds.length > 0) {
    const classes = await classRepository.listInDepartments(institutionId, scope.departmentIds);
    for (const klass of classes) ids.add(String(klass._id));
  }

  return [...ids];
}

/** Load the student shape the pure scope rules test against. */
export async function loadScopedStudent(
  institutionId: string,
  studentUserId: string,
): Promise<ScopedStudent | null> {
  const profile = await studentProfileRepository.findByUserId(institutionId, studentUserId);
  if (!profile) return null;
  return {
    userId: String(profile.userId),
    departmentId: profile.departmentId ? String(profile.departmentId) : null,
    batch: profile.batch ?? null,
    section: profile.section ?? null,
  };
}

/**
 * Throw unless the caller may see this student's records.
 *
 * A student outside the scope is reported as NOT_FOUND rather than FORBIDDEN, matching the
 * platform-wide rule that a refusal must not confirm a record exists.
 */
export async function assertCanViewStudent(
  institutionId: string,
  scope: AcademicScope,
  studentUserId: string,
): Promise<void> {
  if (scope.selfUserId === studentUserId) return;

  // Resolve the student FIRST, through a tenant-scoped read. This has to happen even for an
  // institution-wide caller: "the whole college" means the caller's own college, so a student
  // id from another institution must be absent here rather than waved through. Short-circuiting
  // on `institutionWide` before this lookup let a foreign id return an empty 200 instead of 404.
  const student = await loadScopedStudent(institutionId, studentUserId);
  if (!student) throw Errors.notFound();

  if (scope.institutionWide) return;
  if (!canViewStudent(scope, student)) throw Errors.notFound();
}

/**
 * Build the announcement audience for a reader: their department/batch/section, their roles and
 * their approved club memberships.
 */
export async function buildAudienceContext(principal: Principal): Promise<AudienceContext> {
  const { institutionId, userId, roles } = principal;

  const [studentProfile, facultyProfile, memberships] = await Promise.all([
    studentProfileRepository.findByUserId(institutionId, userId),
    facultyProfileRepository.findByUserId(institutionId, userId),
    clubMembershipRepository.listForUser(institutionId, userId),
  ]);

  const departmentId =
    studentProfile?.departmentId ?? facultyProfile?.departmentId ?? null;

  return {
    userId,
    roles: [...roles],
    departmentId: departmentId ? String(departmentId) : null,
    batch: studentProfile?.batch ?? null,
    section: studentProfile?.section ?? null,
    clubIds: memberships.map((membership) => String(membership.clubId)),
  };
}

export { canViewStudent };
export type { AcademicScope, ScopedStudent };
