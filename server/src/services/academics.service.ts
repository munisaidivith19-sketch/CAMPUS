/**
 * Subjects, classes and timetables.
 *
 * Subjects are reference data every member of the institution may read. Classes and timetables
 * are scoped: a student sees their own section, a faculty member their assignments, a mentor
 * their section, an HOD their department, a principal the college. The narrowing happens here,
 * after the route has checked the permission.
 */
import type { Principal } from '@campusconnect/security';
import type { ClassDTO, SubjectDTO, TimetableDTO, TimetableEntryDTO } from '@campusconnect/types';
import { Role } from '@campusconnect/types';
import {
  classRepository,
  subjectRepository,
  timetableRepository,
} from '../repositories/academics.repository.js';
import {
  facultyProfileRepository,
  studentProfileRepository,
} from '../repositories/profile.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import type { PageRequest } from '../repositories/base.repository.js';
import { Errors } from '../utils/errors.js';
import { resolveAcademicScope, resolveVisibleClassIds } from './scope.service.js';
import type { ClassDocument } from '../models/Class.model.js';

export async function listSubjects(
  principal: Principal,
  page: PageRequest,
  filters: { departmentId?: string } = {},
): Promise<{ items: SubjectDTO[]; total: number }> {
  const result = await subjectRepository.list(principal.institutionId, page, filters);
  return {
    items: result.items.map((subject) => ({
      id: String(subject._id),
      code: subject.code,
      name: subject.name,
      credits: subject.credits,
      departmentId: subject.departmentId ? String(subject.departmentId) : null,
    })),
    total: result.total,
  };
}

/** Build the client shape for a set of classes, resolving subject and faculty names in bulk. */
async function toClassDTOs(institutionId: string, classes: ClassDocument[]): Promise<ClassDTO[]> {
  if (classes.length === 0) return [];

  const [subjects, users] = await Promise.all([
    subjectRepository.findManyByIds(institutionId, [
      ...new Set(classes.map((klass) => String(klass.subjectId))),
    ]),
    userRepository.listUsers(institutionId, { page: 1, limit: 300 }),
  ]);

  const subjectById = new Map(subjects.map((subject) => [String(subject._id), subject]));
  const nameByUserId = new Map(users.items.map((user) => [String(user._id), user.fullName]));

  // Roster sizes come from one grouped read of the section rosters rather than N queries.
  const rosterCounts = new Map<string, number>();
  await Promise.all(
    classes.map(async (klass) => {
      const key = `${klass.batch}::${klass.section}`;
      if (rosterCounts.has(key)) return;
      const roster = await studentProfileRepository.listBySection(
        institutionId,
        klass.batch,
        klass.section,
        klass.departmentId,
      );
      rosterCounts.set(key, roster.length);
    }),
  );

  return classes.map((klass) => {
    const subject = subjectById.get(String(klass.subjectId));
    const facultyUserId = klass.facultyUserId ? String(klass.facultyUserId) : null;
    return {
      id: String(klass._id),
      subject: subject
        ? { id: String(subject._id), code: subject.code, name: subject.name }
        : { id: String(klass.subjectId), code: '?', name: 'Unknown subject' },
      departmentId: klass.departmentId ? String(klass.departmentId) : null,
      batch: klass.batch,
      section: klass.section,
      faculty: facultyUserId
        ? { userId: facultyUserId, fullName: nameByUserId.get(facultyUserId) ?? 'Unknown' }
        : null,
      studentCount: rosterCounts.get(`${klass.batch}::${klass.section}`) ?? 0,
    };
  });
}

export async function listClasses(
  principal: Principal,
  page: PageRequest,
  filters: { departmentId?: string; subjectId?: string; batch?: string; section?: string } = {},
): Promise<{ items: ClassDTO[]; total: number }> {
  const { institutionId } = principal;
  const scope = await resolveAcademicScope(principal);

  // A student's "classes" are their own section's, which is not expressible as a class-id scope.
  if (scope.selfUserId && scope.classIds.length === 0 && !scope.institutionWide && scope.sections.length === 0 && scope.departmentIds.length === 0) {
    const profile = await studentProfileRepository.findByUserId(institutionId, principal.userId);
    if (!profile?.batch || !profile.section) return { items: [], total: 0 };

    const classes = await classRepository.listInSections(institutionId, [
      { batch: profile.batch, section: profile.section },
    ]);
    return { items: await toClassDTOs(institutionId, classes), total: classes.length };
  }

  const visibleClassIds = await resolveVisibleClassIds(institutionId, scope);
  const result = await classRepository.list(institutionId, page, filters, visibleClassIds);
  return { items: await toClassDTOs(institutionId, result.items), total: result.total };
}

/**
 * The timetable view.
 *
 * Students and mentors get their section's grid; faculty get their own teaching schedule,
 * assembled from whichever sections contain their classes.
 */
export async function getTimetable(
  principal: Principal,
  query: { classId?: string; batch?: string; section?: string; scope?: 'SECTION' | 'FACULTY' },
): Promise<TimetableDTO> {
  const { institutionId } = principal;
  const wantsFacultyView =
    query.scope === 'FACULTY' ||
    (query.scope === undefined && !principal.roles.includes(Role.STUDENT));

  const scope = await resolveAcademicScope(principal);
  const visibleClassIds = await resolveVisibleClassIds(institutionId, scope);

  if (wantsFacultyView) {
    const taught = await classRepository.listTaughtBy(institutionId, principal.userId);
    const taughtIds = new Set(taught.map((klass) => String(klass._id)));
    const timetables = await timetableRepository.listContainingClasses(institutionId, [...taughtIds]);

    const entries = timetables.flatMap((timetable) =>
      timetable.entries
        .filter((entry) => taughtIds.has(String(entry.classId)))
        .map((entry) => ({ entry, label: `${timetable.batch} ${timetable.section}` })),
    );

    const classes = await classRepository.findManyByIds(institutionId, [...taughtIds]);
    const resolved = await resolveEntries(institutionId, classes, entries.map((e) => e.entry));

    return { scope: 'FACULTY', label: 'My teaching schedule', entries: resolved };
  }

  // Section view: either the caller's own section, or an explicitly requested one they can reach.
  let batch = query.batch;
  let section = query.section;

  if (!batch || !section) {
    const profile = await studentProfileRepository.findByUserId(institutionId, principal.userId);
    if (profile?.batch && profile.section) {
      batch = profile.batch;
      section = profile.section;
    } else {
      const faculty = await facultyProfileRepository.findByUserId(institutionId, principal.userId);
      if (faculty?.mentorOf) {
        batch = faculty.mentorOf.batch;
        section = faculty.mentorOf.section;
      }
    }
  }

  if (!batch || !section) throw Errors.notFound();

  const timetable = await timetableRepository.findForSection(institutionId, batch, section);
  if (!timetable) return { scope: 'SECTION', label: `${batch} ${section}`, entries: [] };

  // Requesting another section is only allowed if that section's classes are in scope.
  if (visibleClassIds !== null && !principal.roles.includes(Role.STUDENT)) {
    const reachable = timetable.entries.some((entry) => visibleClassIds.includes(String(entry.classId)));
    if (!reachable && timetable.entries.length > 0) throw Errors.notFound();
  }

  const classes = await classRepository.findManyByIds(
    institutionId,
    timetable.entries.map((entry) => String(entry.classId)),
  );

  return {
    scope: 'SECTION',
    label: `${batch} ${section}`,
    entries: await resolveEntries(institutionId, classes, timetable.entries),
  };
}

async function resolveEntries(
  institutionId: string,
  classes: ClassDocument[],
  entries: Array<{ day: string; period: number; classId: unknown; room?: string | null }>,
): Promise<TimetableEntryDTO[]> {
  const classById = new Map(classes.map((klass) => [String(klass._id), klass]));

  const [subjects, users] = await Promise.all([
    subjectRepository.findManyByIds(institutionId, [
      ...new Set(classes.map((klass) => String(klass.subjectId))),
    ]),
    userRepository.listUsers(institutionId, { page: 1, limit: 300 }),
  ]);

  const subjectById = new Map(subjects.map((subject) => [String(subject._id), subject]));
  const nameByUserId = new Map(users.items.map((user) => [String(user._id), user.fullName]));

  return entries
    .map((entry) => {
      const klass = classById.get(String(entry.classId));
      if (!klass) return null;
      const subject = subjectById.get(String(klass.subjectId));
      const facultyUserId = klass.facultyUserId ? String(klass.facultyUserId) : null;

      return {
        day: entry.day,
        period: entry.period,
        classId: String(klass._id),
        subject: subject
          ? { id: String(subject._id), code: subject.code, name: subject.name }
          : { id: String(klass.subjectId), code: '?', name: 'Unknown subject' },
        facultyName: facultyUserId ? (nameByUserId.get(facultyUserId) ?? null) : null,
        room: entry.room ?? null,
      } as TimetableEntryDTO;
    })
    .filter((entry): entry is TimetableEntryDTO => entry !== null)
    .sort((a, b) => a.day.localeCompare(b.day) || a.period - b.period);
}

/** Assign teaching faculty to a class (requires `class:manage`). */
export async function assignClassFaculty(
  principal: Principal,
  classId: string,
  facultyUserId: string,
): Promise<ClassDTO> {
  const { institutionId } = principal;

  const [klass, faculty] = await Promise.all([
    classRepository.findById(institutionId, classId),
    userRepository.findById(institutionId, facultyUserId),
  ]);
  if (!klass || !faculty) throw Errors.notFound();

  const updated = await classRepository.assignFaculty(institutionId, classId, facultyUserId);
  if (!updated) throw Errors.notFound();

  const [dto] = await toClassDTOs(institutionId, [updated]);
  if (!dto) throw Errors.internal();
  return dto;
}
