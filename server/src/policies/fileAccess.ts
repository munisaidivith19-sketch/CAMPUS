/**
 * File authorization, as pure rules.
 *
 * The service loads the facts — the file row, and whether the caller can read the resource the
 * file is linked to (answered by that resource's OWN rules) — and asks these functions what is
 * allowed. Nothing here touches the database, so the rules are tested exhaustively on their own.
 *
 *  - **A file has no access list of its own.** Until it is linked it belongs to its owner alone.
 *    Once linked it is readable by exactly those who can read the chat message, announcement or
 *    other resource it is attached to — so losing access to that resource loses the file too.
 *  - **Absence is NOT_FOUND.** Every "no" here surfaces as 404 so a file id cannot be probed.
 *  - **Scanning gates the bytes.** Metadata may be visible while the bytes are not: only CLEAN
 *    files download everywhere, SKIPPED (scanner disabled) only where unscanned downloads are
 *    allowed (development), and SCAN_FAILED / INFECTED / PENDING never.
 */
import { FileScanStatus, FileVisibility, Permission } from '@campusconnect/types';
import type { Principal } from '@campusconnect/security';

export interface FileFacts {
  institutionId: string;
  ownerUserId: string;
  visibility: FileVisibility;
  scanStatus: FileScanStatus;
  deleted: boolean;
}

const has = (principal: Principal, permission: Permission): boolean =>
  principal.permissions.includes(permission);

export const fileAccess = {
  canUpload(principal: Principal): boolean {
    return has(principal, Permission.FILE_UPLOAD);
  },

  isOwner(principal: Principal, file: FileFacts): boolean {
    return file.institutionId === principal.institutionId && file.ownerUserId === principal.userId;
  },

  /**
   * May the caller see this file at all (metadata, and — scan permitting — bytes)?
   * `linkedReadable` is the linked resource's own verdict; it is ignored for private files.
   */
  canView(principal: Principal, file: FileFacts, linkedReadable: boolean): boolean {
    if (file.institutionId !== principal.institutionId) return false;
    if (file.deleted) return false;
    if (!has(principal, Permission.FILE_READ)) return false;
    if (file.ownerUserId === principal.userId) return true;
    return file.visibility === FileVisibility.LINKED && linkedReadable;
  },

  /** Whether a scan status lets the bytes out. */
  isDownloadableStatus(status: FileScanStatus, allowUnscanned: boolean): boolean {
    if (status === FileScanStatus.CLEAN) return true;
    return status === FileScanStatus.SKIPPED && allowUnscanned;
  },

  /**
   * May the caller attach this file to something? Only their own, same-tenant, live, not yet
   * linked file whose bytes would be downloadable — attaching a file you cannot share would hand
   * everyone else a card that leads nowhere.
   */
  canLink(principal: Principal, file: FileFacts, allowUnscanned: boolean): boolean {
    return (
      fileAccess.isOwner(principal, file) &&
      !file.deleted &&
      file.visibility === FileVisibility.PRIVATE &&
      fileAccess.isDownloadableStatus(file.scanStatus, allowUnscanned)
    );
  },

  /** Only your own files that are not attached to anything may be deleted directly. */
  canDeleteDirectly(principal: Principal, file: FileFacts): boolean {
    return (
      fileAccess.isOwner(principal, file) &&
      !file.deleted &&
      file.visibility === FileVisibility.PRIVATE
    );
  },

  /** Statuses a file may be linked in, for the repository's conditional claim. */
  linkableStatuses(allowUnscanned: boolean): FileScanStatus[] {
    return allowUnscanned ? [FileScanStatus.CLEAN, FileScanStatus.SKIPPED] : [FileScanStatus.CLEAN];
  },
};
