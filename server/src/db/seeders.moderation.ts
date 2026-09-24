/**
 * Development seed for the moderation queue. SYNTHETIC DATA ONLY.
 *
 * Files one open report against a seeded discussion so the queue has something to show.
 * Idempotent through the one-report-per-reporter-per-target index.
 */
import { Role } from '@campusconnect/types';
import type { InstitutionDocument } from '../models/Institution.model.js';
import { DiscussionModel } from '../models/Discussion.model.js';
import { UserModel } from '../models/User.model.js';
import { contentReportRepository } from '../repositories/moderation.repository.js';
import { discussionRepository } from '../repositories/discussion.repository.js';

export async function seedModeration(institution: InstitutionDocument): Promise<void> {
  const discussion = await DiscussionModel.findOne({
    institutionId: institution._id,
    title: 'Lost: blue water bottle near the CS block',
  }).exec();
  if (!discussion) return;

  // Any student other than the author reports it.
  const reporter = await UserModel.findOne({
    institutionId: institution._id,
    roles: Role.STUDENT,
    _id: { $ne: discussion.authorUserId },
  }).exec();
  if (!reporter) return;

  const created = await contentReportRepository.recordOnce(institution._id, {
    targetType: 'DISCUSSION',
    targetId: discussion._id,
    reporterUserId: reporter._id,
    reason: 'Synthetic demo report: posted in the wrong category.',
    context: { kind: 'COMMUNITY' },
  });
  if (created) await discussionRepository.incrementReportCount(institution._id, discussion._id);
}
