/**
 * Secure file sharing (Phase 3 Part C-3).
 *
 * The upload pipeline runs in a fixed order and fails closed at every step (SECURITY.md §7):
 *
 *   permission → quota → declared name + type allowlisted → bytes streamed to storage with the
 *   size limit enforced WHILE streaming → magic bytes / text / polyglot checks → ZIP limits on
 *   archives and Office containers → malware scan → metadata persisted
 *
 * A rejected upload leaves no bytes behind. An infected one leaves only its metadata row, kept
 * as INFECTED for the record. One the scanner could not reach is kept as SCAN_FAILED: held, not
 * shareable, not downloadable, and removed by the orphan cleanup like any unattached file.
 *
 * Access is inherited, never stored: a file is its owner's until it is linked, and then belongs
 * to whoever can read the resource it is linked to. Each resource type registers its own read
 * check here (`registerLinkedResourceReader`) — the chat module answers for chat messages, the
 * announcement module for announcements — so this file never re-implements another module's
 * rules, and later modules (complaints, lost & found, achievements…) plug in the same way.
 */
import type { Readable } from 'node:stream';
import {
  AuditAction,
  AuditResult,
  FileScanStatus,
  FileVisibility,
  UserStatus,
  type AttachmentDTO,
  type FileDTO,
  type FileDownloadDTO,
  type LinkedResourceType,
} from '@campusconnect/types';
import type { Principal } from '@campusconnect/security';
import { API_PREFIX } from '@campusconnect/config';
import { config } from '../config/env.js';
import { getStorage, StorageSizeExceededError } from '../infra/storage/index.js';
import { scanStream, ScannerUnavailableError } from '../infra/clamav.js';
import type { FileDocument } from '../models/File.model.js';
import { fileRepository, type ResourceRef } from '../repositories/file.repository.js';
import { institutionRepository } from '../repositories/institution.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { fileAccess, type FileFacts } from '../policies/fileAccess.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { attachmentDisposition, sanitizeFileName } from '../utils/fileName.js';
import { signDownloadToken, verifyDownloadToken } from '../utils/fileSigning.js';
import { inspectFile, resolveAllowedType } from './fileInspection.js';
import { recordAudit, type AuditContext } from './audit.service.js';
import { resolvePermissions } from './rbac.service.js';

/** Unscanned (SKIPPED) files are shareable only outside production. */
const allowUnscanned = (): boolean => !config.isProd;

// --- Scanner settings -------------------------------------------------------------

export interface ScannerSettings {
  enabled: boolean;
  host: string;
  port: number;
  timeoutMs: number;
}

let scannerOverride: ScannerSettings | null = null;

function scannerSettings(): ScannerSettings {
  return (
    scannerOverride ?? {
      enabled: config.CLAMAV_ENABLED,
      host: config.CLAMAV_HOST,
      port: config.CLAMAV_PORT,
      timeoutMs: config.CLAMAV_TIMEOUT_MS,
    }
  );
}

/**
 * Point the pipeline at a different scanner (a fake clamd, a dead port). Config is frozen at
 * boot, so tests use this instead; production code never calls it.
 */
export function setScannerForTesting(settings: ScannerSettings | null): void {
  scannerOverride = settings;
}

// --- Linked-resource readers ----------------------------------------------------

/**
 * Answers "may this principal read this resource?" using the resource's own rules. Must return
 * false — never throw a 403 — for anything the caller cannot see.
 */
export type LinkedResourceReader = (
  principal: Principal,
  resource: ResourceRef,
) => Promise<boolean>;

const readers = new Map<LinkedResourceType, LinkedResourceReader>();

export function registerLinkedResourceReader(
  type: LinkedResourceType,
  reader: LinkedResourceReader,
): void {
  readers.set(type, reader);
}

async function canReadLinked(principal: Principal, file: FileDocument): Promise<boolean> {
  const linked = file.linkedResource;
  if (file.visibility !== FileVisibility.LINKED || !linked) return false;
  const reader = readers.get(linked.type);
  // No registered reader for this kind of resource: nobody but the owner may read it.
  if (!reader) return false;
  try {
    return await reader(principal, {
      type: linked.type,
      id: String(linked.id),
      contextId: linked.contextId ? String(linked.contextId) : null,
    });
  } catch {
    return false;
  }
}

// --- DTOs -----------------------------------------------------------------------

function factsOf(file: FileDocument): FileFacts {
  return {
    institutionId: String(file.institutionId),
    ownerUserId: String(file.ownerUserId),
    visibility: file.visibility,
    scanStatus: file.scanStatus,
    deleted: file.deletedAt !== null && file.deletedAt !== undefined,
  };
}

function toFileDTO(principal: Principal, file: FileDocument): FileDTO {
  return {
    id: String(file._id),
    name: file.originalName,
    mime: file.mime,
    size: file.size,
    checksum: file.checksum,
    scanStatus: file.scanStatus,
    visibility: file.visibility,
    linkedResource: file.linkedResource
      ? { type: file.linkedResource.type, id: String(file.linkedResource.id) }
      : null,
    downloadable: fileAccess.isDownloadableStatus(file.scanStatus, allowUnscanned()),
    isOwner: String(file.ownerUserId) === principal.userId,
    createdAt: file.createdAt.toISOString(),
  };
}

export function toAttachmentDTO(file: FileDocument): AttachmentDTO {
  return {
    id: String(file._id),
    name: file.originalName,
    mime: file.mime,
    size: file.size,
    scanStatus: file.scanStatus,
  };
}

// --- Upload ---------------------------------------------------------------------

export interface IncomingFile {
  stream: Readable;
  /** The client's filename, untrusted. */
  fileName: string;
  /** The client's declared MIME type, untrusted. */
  declaredMime: string;
}

/** Throw away a stream we will not store, without leaving the client hanging. */
function discard(stream: Readable): void {
  stream.resume();
}

export async function uploadFile(
  principal: Principal,
  incoming: IncomingFile,
  context: AuditContext,
): Promise<FileDTO> {
  const { institutionId, userId } = principal;
  const storage = getStorage();

  if (!fileAccess.canUpload(principal)) {
    discard(incoming.stream);
    throw Errors.forbidden();
  }

  // Quota first: an upload that cannot fit is refused before a byte is stored.
  const used = await fileRepository.usedBytes(institutionId, userId);
  if (used >= config.USER_UPLOAD_QUOTA_BYTES) {
    discard(incoming.stream);
    throw Errors.quotaExceeded();
  }

  // The declared name and type must name one allowlisted type, or nothing is stored at all.
  const { name, extension } = sanitizeFileName(incoming.fileName);
  const spec = resolveAllowedType(extension, config.UPLOAD_ALLOWED_TYPES);
  const declaredMime = incoming.declaredMime.toLowerCase().split(';')[0]?.trim() ?? '';
  if (!spec || !spec.declared.includes(declaredMime)) {
    discard(incoming.stream);
    throw Errors.unsupportedMediaType();
  }

  let stored;
  try {
    stored = await storage.put(incoming.stream, {
      institutionId,
      maxBytes: config.MAX_UPLOAD_BYTES,
    });
  } catch (err) {
    if (err instanceof StorageSizeExceededError) throw Errors.payloadTooLarge();
    throw err;
  }

  const rejectStored = async (): Promise<void> => {
    await storage.delete(stored.storageKey);
  };

  if (used + stored.size > config.USER_UPLOAD_QUOTA_BYTES) {
    await rejectStored();
    throw Errors.quotaExceeded();
  }

  const inspection = await inspectFile(storage.localPath(stored.storageKey), stored.size, spec, {
    maxEntries: config.ZIP_MAX_ENTRIES,
    maxRatio: config.ZIP_MAX_RATIO,
    maxTotalBytes: config.ZIP_MAX_TOTAL_BYTES,
  });
  if (!inspection.ok) {
    await rejectStored();
    logger.warn(
      { userId, extension: spec.ext, reason: inspection.reason },
      'Upload refused by content inspection',
    );
    throw Errors.unsupportedMediaType(
      'This file’s contents are not an allowed type, or it is not safe to share.',
    );
  }

  // Malware scan.
  let scanStatus: FileScanStatus = FileScanStatus.SKIPPED;
  let scanSignature: string | null = null;
  const scanner = scannerSettings();
  if (scanner.enabled) {
    try {
      const verdict = await scanStream(storage.getStream(stored.storageKey), scanner);
      if (verdict.status === 'INFECTED') {
        scanStatus = FileScanStatus.INFECTED;
        scanSignature = verdict.signature;
      } else {
        scanStatus = FileScanStatus.CLEAN;
      }
    } catch (err) {
      if (!(err instanceof ScannerUnavailableError)) throw err;
      logger.error(
        { err: err.message },
        'Malware scanner unavailable — holding upload as SCAN_FAILED',
      );
      scanStatus = FileScanStatus.SCAN_FAILED;
    }
  }

  const row = await fileRepository.create(institutionId, {
    ownerUserId: userId,
    storageKey: stored.storageKey,
    originalName: name,
    extension: spec.ext,
    mime: spec.mime,
    size: stored.size,
    checksum: stored.sha256,
    scanStatus,
    scanSignature,
  });

  if (scanStatus === FileScanStatus.INFECTED) {
    // The bytes go immediately; the row stays as the record of what was refused.
    await rejectStored();
    await fileRepository.claimDeletion(institutionId, { _id: row._id }, null, 'MALWARE');
    await recordAudit({
      institutionId,
      actorUserId: userId,
      action: AuditAction.FILE_MALWARE_DETECTED,
      resourceType: 'File',
      resourceId: String(row._id),
      result: AuditResult.DENIED,
      context,
      reason: scanSignature,
    });
    throw Errors.malwareDetected();
  }

  await recordAudit({
    institutionId,
    actorUserId: userId,
    action: AuditAction.FILE_UPLOADED,
    resourceType: 'File',
    resourceId: String(row._id),
    result: scanStatus === FileScanStatus.SCAN_FAILED ? AuditResult.FAILURE : AuditResult.SUCCESS,
    context,
    reason: `type=${spec.ext} size=${stored.size} scan=${scanStatus}`,
  });

  if (scanStatus === FileScanStatus.SCAN_FAILED) throw Errors.scanFailed();

  return toFileDTO(principal, row);
}

// --- Reading --------------------------------------------------------------------

/** Load a file the caller may see, or throw NOT_FOUND. */
async function loadVisible(principal: Principal, fileId: string): Promise<FileDocument> {
  const file = await fileRepository.findLive(principal.institutionId, fileId);
  if (!file) throw Errors.notFound();
  const facts = factsOf(file);
  const isOwner = fileAccess.isOwner(principal, facts);
  const linkedReadable = isOwner ? false : await canReadLinked(principal, file);
  if (!fileAccess.canView(principal, facts, linkedReadable)) throw Errors.notFound();
  return file;
}

export async function getFile(principal: Principal, fileId: string): Promise<FileDTO> {
  return toFileDTO(principal, await loadVisible(principal, fileId));
}

/**
 * Mint a short-lived signed URL for the bytes. Re-authorizes now; the content endpoint
 * re-authorizes again when the URL is used.
 */
export async function createDownload(
  principal: Principal,
  fileId: string,
): Promise<FileDownloadDTO> {
  const file = await loadVisible(principal, fileId);
  if (!fileAccess.isDownloadableStatus(file.scanStatus, allowUnscanned())) {
    throw Errors.conflict('This file has not passed malware scanning and cannot be downloaded.');
  }

  const expiresAt = Math.floor(Date.now() / 1000) + config.FILE_DOWNLOAD_TOKEN_TTL_S;
  const token = signDownloadToken({
    fileId: String(file._id),
    userId: principal.userId,
    institutionId: principal.institutionId,
    expiresAt,
  });

  return {
    file: toFileDTO(principal, file),
    url: `${API_PREFIX}/files/${String(file._id)}/content?token=${token}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

/** Rebuild the principal a download token was minted for, from current data (fail closed). */
async function principalForToken(institutionId: string, userId: string): Promise<Principal | null> {
  const user = await userRepository.findById(institutionId, userId);
  if (!user || user.status !== UserStatus.ACTIVE) return null;
  const permissions = await resolvePermissions(institutionId, user.roles);
  return { userId, institutionId, roles: user.roles, permissions };
}

export interface FileContent {
  stream: Readable;
  size: number;
  mime: string;
  disposition: string;
}

/**
 * Resolve a signed URL to the bytes. Every failure — bad signature, expired, other file, the
 * user lost access since the URL was minted, the file was deleted — is the same NOT_FOUND.
 */
export async function openContent(fileId: string, token: string): Promise<FileContent> {
  const claims = verifyDownloadToken(token);
  if (!claims || claims.fileId !== fileId) throw Errors.notFound();

  const principal = await principalForToken(claims.institutionId, claims.userId);
  if (!principal) throw Errors.notFound();

  const file = await loadVisible(principal, fileId);
  if (!fileAccess.isDownloadableStatus(file.scanStatus, allowUnscanned())) throw Errors.notFound();

  const storage = getStorage();
  if (!(await storage.exists(file.storageKey))) throw Errors.notFound();

  return {
    stream: storage.getStream(file.storageKey),
    size: file.size,
    mime: file.mime,
    disposition: attachmentDisposition(file.originalName),
  };
}

// --- Linking --------------------------------------------------------------------

/**
 * Attach the caller's own files to a resource, all or nothing. Any id that is not the caller's
 * own live, clean, unattached file — someone else's, another tenant's, already attached, not
 * yet cleared by the scanner — fails the whole call with NOT_FOUND.
 */
export async function linkFiles(
  principal: Principal,
  fileIds: readonly string[],
  resource: ResourceRef,
): Promise<void> {
  if (fileIds.length === 0) return;
  const linked = await fileRepository.linkAll(
    principal.institutionId,
    principal.userId,
    fileIds,
    resource,
    fileAccess.linkableStatuses(allowUnscanned()),
  );
  if (!linked) throw Errors.notFound();
}

/** Release a link made for a resource whose creation then failed. */
export async function unlinkFiles(
  institutionId: string,
  fileIds: readonly string[],
  resource: ResourceRef,
): Promise<void> {
  await fileRepository.unlinkMany(institutionId, fileIds, resource);
}

/** Attachment metadata for many resources of one type, keyed by resource id. */
export async function attachmentsFor(
  institutionId: string,
  type: LinkedResourceType,
  resourceIds: readonly string[],
): Promise<Map<string, AttachmentDTO[]>> {
  const files = await fileRepository.listForResources(institutionId, type, resourceIds);
  const byResource = new Map<string, AttachmentDTO[]>();
  for (const file of files) {
    const key = String(file.linkedResource?.id);
    const list = byResource.get(key) ?? [];
    list.push(toAttachmentDTO(file));
    byResource.set(key, list);
  }
  return byResource;
}

// --- Deleting -------------------------------------------------------------------

async function removeBytes(file: FileDocument): Promise<void> {
  try {
    await getStorage().delete(file.storageKey);
  } catch (err) {
    // The row is already marked deleted, so nothing can be served; the bytes are an orphan on
    // disk that an operator can reclaim. Logged, not thrown.
    logger.error({ err, fileId: String(file._id) }, 'Failed to remove file bytes');
  }
}

/** Delete one of your own unattached files. */
export async function deleteOwnFile(
  principal: Principal,
  fileId: string,
  context: AuditContext,
): Promise<void> {
  const file = await fileRepository.findLive(principal.institutionId, fileId);
  if (!file || !fileAccess.isOwner(principal, factsOf(file))) throw Errors.notFound();
  if (!fileAccess.canDeleteDirectly(principal, factsOf(file))) {
    throw Errors.conflict('This file is attached to something; delete that instead.');
  }

  const claimed = await fileRepository.claimDeletion(
    principal.institutionId,
    { _id: file._id, ownerUserId: file.ownerUserId, visibility: FileVisibility.PRIVATE },
    principal.userId,
    'OWNER',
  );
  if (!claimed) throw Errors.notFound();
  await removeBytes(claimed);

  await recordAudit({
    institutionId: principal.institutionId,
    actorUserId: principal.userId,
    action: AuditAction.FILE_DELETED,
    resourceType: 'File',
    resourceId: fileId,
    result: AuditResult.SUCCESS,
    context,
    reason: 'OWNER',
  });
}

/**
 * Delete every file attached to a resource that is itself being deleted (a chat message, …).
 * The resource's own delete is what is audited; this records who removed the files and why.
 */
export async function deleteFilesForResource(
  institutionId: string,
  type: LinkedResourceType,
  resourceId: string,
  actorUserId: string,
  reason: 'RESOURCE_DELETED' | 'MODERATOR',
): Promise<number> {
  const files = await fileRepository.listForResources(institutionId, type, [resourceId]);
  let removed = 0;
  for (const file of files) {
    const claimed = await fileRepository.claimDeletion(
      institutionId,
      { _id: file._id },
      actorUserId,
      reason,
    );
    if (claimed) {
      await removeBytes(claimed);
      removed += 1;
    }
  }
  return removed;
}

// --- Orphan cleanup -------------------------------------------------------------

/**
 * Remove unattached files older than the orphan TTL, across every institution.
 *
 * Safe to run on every instance at once: each file is claimed with one conditional update that
 * re-checks it is still unattached, undeleted and old enough, and only the instance whose claim
 * succeeds removes the bytes. A file linked between the listing and the claim simply no longer
 * matches.
 */
export async function runOrphanCleanup(now = new Date(), batchSize = 200): Promise<number> {
  const cutoff = new Date(now.getTime() - config.FILE_ORPHAN_TTL_HOURS * 3_600_000);
  const institutionIds = await institutionRepository.listIds();
  let removed = 0;

  for (const institutionId of institutionIds) {
    const candidates = await fileRepository.listOrphanIds(institutionId, cutoff, batchSize);
    for (const id of candidates) {
      const claimed = await fileRepository.claimDeletion(
        institutionId,
        { _id: id, visibility: FileVisibility.PRIVATE, createdAt: { $lt: cutoff } },
        null,
        'ORPHAN',
      );
      if (claimed) {
        await removeBytes(claimed);
        removed += 1;
      }
    }
  }

  if (removed > 0) logger.info({ removed }, 'Removed orphaned uploads');
  return removed;
}
