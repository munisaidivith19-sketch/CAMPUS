/**
 * Role profiles (student / faculty).
 *
 * Only fields a person may reasonably maintain about themselves are updatable here. Identifying
 * and organizational fields — roll number, department — are administrative on purpose: letting
 * a student edit their own roll number would undermine every record keyed to it.
 */
import type { FacultyProfileDTO, StudentProfileDTO } from '@campusconnect/types';
import { AuditAction, AuditResult } from '@campusconnect/types';
import type { StudentProfileDocument } from '../models/StudentProfile.model.js';
import type { FacultyProfileDocument } from '../models/FacultyProfile.model.js';
import { facultyProfileRepository, studentProfileRepository } from '../repositories/profile.repository.js';
import type { IdLike } from '../repositories/base.repository.js';
import { recordAudit, type AuditContext } from './audit.service.js';
import { Errors } from '../utils/errors.js';

export function toStudentProfileDTO(profile: StudentProfileDocument): StudentProfileDTO {
  return {
    id: String(profile._id),
    userId: String(profile.userId),
    rollNo: profile.rollNo,
    departmentId: profile.departmentId ? String(profile.departmentId) : null,
    batch: profile.batch ?? null,
    year: profile.year ?? null,
    section: profile.section ?? null,
  };
}

export function toFacultyProfileDTO(profile: FacultyProfileDocument): FacultyProfileDTO {
  return {
    id: String(profile._id),
    userId: String(profile.userId),
    departmentId: profile.departmentId ? String(profile.departmentId) : null,
    designation: profile.designation ?? null,
    subjectsTaught: [...profile.subjectsTaught],
  };
}

export async function getStudentProfile(
  institutionId: IdLike,
  userId: IdLike,
): Promise<StudentProfileDTO> {
  const profile = await studentProfileRepository.findByUserId(institutionId, userId);
  if (!profile) throw Errors.notFound();
  return toStudentProfileDTO(profile);
}

export async function getFacultyProfile(
  institutionId: IdLike,
  userId: IdLike,
): Promise<FacultyProfileDTO> {
  const profile = await facultyProfileRepository.findByUserId(institutionId, userId);
  if (!profile) throw Errors.notFound();
  return toFacultyProfileDTO(profile);
}

export async function updateStudentProfile(
  institutionId: IdLike,
  userId: IdLike,
  fields: { batch?: string; year?: number; section?: string },
  context: AuditContext,
): Promise<StudentProfileDTO> {
  const updated = await studentProfileRepository.update(institutionId, userId, fields);
  if (!updated) throw Errors.notFound();

  await recordAudit({
    institutionId,
    actorUserId: userId,
    action: AuditAction.PROFILE_UPDATED,
    resourceType: 'StudentProfile',
    resourceId: String(updated._id),
    result: AuditResult.SUCCESS,
    context,
  });

  return toStudentProfileDTO(updated);
}

export async function updateFacultyProfile(
  institutionId: IdLike,
  userId: IdLike,
  fields: { designation?: string; subjectsTaught?: string[] },
  context: AuditContext,
): Promise<FacultyProfileDTO> {
  const updated = await facultyProfileRepository.update(institutionId, userId, fields);
  if (!updated) throw Errors.notFound();

  await recordAudit({
    institutionId,
    actorUserId: userId,
    action: AuditAction.PROFILE_UPDATED,
    resourceType: 'FacultyProfile',
    resourceId: String(updated._id),
    result: AuditResult.SUCCESS,
    context,
  });

  return toFacultyProfileDTO(updated);
}
