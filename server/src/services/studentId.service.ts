/**
 * Digital student ID issuance and lookup.
 *
 * Issuing a new card revokes any previous active one, so exactly one card is valid at a time.
 * Card numbers carry a random suffix rather than a running sequence: a card number should not
 * be guessable from another student's, and re-issuing must not collide with a revoked card
 * (the unique index covers revoked cards too).
 */
import { randomBytes } from 'node:crypto';
import { AuditAction, AuditResult, type StudentIdDTO } from '@campusconnect/types';
import { studentIdRepository } from '../repositories/studentId.repository.js';
import { studentProfileRepository } from '../repositories/profile.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import type { IdLike } from '../repositories/base.repository.js';
import { recordAudit, type AuditContext } from './audit.service.js';
import { Errors } from '../utils/errors.js';
import type { StudentIDDocument } from '../models/StudentID.model.js';

/** Default validity when the caller does not specify one: one academic year. */
const DEFAULT_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

function buildCardNo(rollNo: string): string {
  return `${rollNo.toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
}

async function toStudentIdDTO(card: StudentIDDocument): Promise<StudentIdDTO> {
  const institutionId = String(card.institutionId);
  const [user, profile] = await Promise.all([
    userRepository.findById(institutionId, card.userId),
    studentProfileRepository.findByUserId(institutionId, card.userId),
  ]);

  return {
    id: String(card._id),
    cardNo: card.cardNo,
    status: card.status,
    validFrom: card.validFrom.toISOString(),
    validTo: card.validTo.toISOString(),
    holder: {
      userId: String(card.userId),
      fullName: user?.fullName ?? 'Unknown',
      rollNo: profile?.rollNo ?? 'Unknown',
    },
  };
}

export async function issueStudentId(
  institutionId: IdLike,
  actorUserId: IdLike,
  targetUserId: IdLike,
  validTo: Date | undefined,
  context: AuditContext,
): Promise<StudentIdDTO> {
  const profile = await studentProfileRepository.findByUserId(institutionId, targetUserId);
  // No student profile in this tenant → nothing to issue a card against, and we do not
  // distinguish "wrong tenant" from "not a student" to the caller.
  if (!profile) throw Errors.notFound();

  await studentIdRepository.revokeForUser(institutionId, targetUserId);

  const card = await studentIdRepository.create({
    institutionId,
    studentProfileId: profile._id,
    userId: targetUserId,
    cardNo: buildCardNo(profile.rollNo),
    validFrom: new Date(),
    validTo: validTo ?? new Date(Date.now() + DEFAULT_VALIDITY_MS),
    issuedByUserId: actorUserId,
  });

  await recordAudit({
    institutionId,
    actorUserId,
    action: AuditAction.STUDENT_ID_ISSUED,
    resourceType: 'StudentID',
    resourceId: String(card._id),
    result: AuditResult.SUCCESS,
    context,
  });

  return toStudentIdDTO(card);
}

export async function getActiveStudentId(
  institutionId: IdLike,
  userId: IdLike,
): Promise<StudentIdDTO> {
  const card = await studentIdRepository.findActiveForUser(institutionId, userId);
  if (!card) throw Errors.notFound();
  return toStudentIdDTO(card);
}
