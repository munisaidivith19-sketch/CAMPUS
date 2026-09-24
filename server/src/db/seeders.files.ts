/**
 * Development seed for file sharing (Phase 3 Part C-3). SYNTHETIC DATA ONLY.
 *
 * Attaches a small, generated PDF to the seeded department announcement so the attachment card,
 * scan badge and signed download can be demonstrated without uploading anything by hand. The
 * bytes go through the real storage provider; the metadata row is what the upload pipeline would
 * have written for a file the scanner never saw (SKIPPED — downloadable in development only).
 * Idempotent: an announcement that already has attachments is left alone.
 */
import { Readable } from 'node:stream';
import { FileScanStatus, LinkedResourceType } from '@campusconnect/types';
import { getStorage, initStorage } from '../infra/storage/index.js';
import type { InstitutionDocument } from '../models/Institution.model.js';
import { AnnouncementModel } from '../models/Announcement.model.js';
import { fileRepository } from '../repositories/file.repository.js';

const SEEDED_TITLE = 'Mid-semester examination schedule published';

function syntheticPdf(): Buffer {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
      '2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n' +
      '% Synthetic mid-semester schedule for local development. Not a real document.\n' +
      'trailer << /Root 1 0 R >>\n%%EOF\n',
    'latin1',
  );
}

export async function seedFiles(institution: InstitutionDocument): Promise<void> {
  const institutionId = String(institution._id);
  const announcement = await AnnouncementModel.findOne({
    institutionId: institution._id,
    title: SEEDED_TITLE,
  }).exec();
  if (!announcement || (announcement.attachmentFileIds ?? []).length > 0) return;

  await initStorage();
  const stored = await getStorage().put(Readable.from([syntheticPdf()]), {
    institutionId,
    maxBytes: 1024 * 1024,
  });

  const file = await fileRepository.create(institutionId, {
    ownerUserId: announcement.authorUserId,
    storageKey: stored.storageKey,
    originalName: 'mid-semester-schedule.pdf',
    extension: 'pdf',
    mime: 'application/pdf',
    size: stored.size,
    checksum: stored.sha256,
    scanStatus: FileScanStatus.SKIPPED,
  });

  const linked = await fileRepository.linkAll(
    institutionId,
    announcement.authorUserId,
    [file._id],
    { type: LinkedResourceType.ANNOUNCEMENT, id: announcement._id },
    [FileScanStatus.SKIPPED, FileScanStatus.CLEAN],
  );
  if (linked) {
    await AnnouncementModel.updateOne(
      { _id: announcement._id },
      { $set: { attachmentFileIds: [file._id] } },
    ).exec();
  }
}
