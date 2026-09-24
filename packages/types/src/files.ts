/**
 * File sharing contracts (Phase 3 Part C-3).
 *
 * File BYTES live behind the server's storage abstraction; MongoDB holds only metadata. A file
 * never carries its own access list: until it is linked it is PRIVATE to its owner, and once
 * linked it is readable by exactly the people who can read the resource it is linked to.
 */

/**
 * Where a file stands with the malware scanner.
 *
 * Only CLEAN files are downloadable in every environment. SKIPPED (scanning disabled) is
 * downloadable in development only and is always labelled "not scanned". SCAN_FAILED (the
 * scanner could not be reached) and INFECTED are never downloadable.
 */
export const FileScanStatus = {
  PENDING: 'PENDING',
  CLEAN: 'CLEAN',
  INFECTED: 'INFECTED',
  SCAN_FAILED: 'SCAN_FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type FileScanStatus = (typeof FileScanStatus)[keyof typeof FileScanStatus];

export const FileVisibility = {
  /** Owner only. Every file starts here. */
  PRIVATE: 'PRIVATE',
  /** Readable by whoever can read the linked resource — and nobody else. */
  LINKED: 'LINKED',
} as const;
export type FileVisibility = (typeof FileVisibility)[keyof typeof FileVisibility];

/**
 * The kinds of resource a file can be attached to. Generic by design: later modules (complaints,
 * lost & found, achievements, resumes) add a kind here and register a read check on the server,
 * and inherit the whole upload/scan/download pipeline unchanged.
 */
export const LinkedResourceType = {
  CHAT_MESSAGE: 'CHAT_MESSAGE',
  ANNOUNCEMENT: 'ANNOUNCEMENT',
} as const;
export type LinkedResourceType = (typeof LinkedResourceType)[keyof typeof LinkedResourceType];

export interface FileDTO {
  id: string;
  /** Sanitized display name. Never used to build a path. */
  name: string;
  /** The server-verified type, not what the client declared. */
  mime: string;
  size: number;
  /** Hex SHA-256 of the stored bytes. */
  checksum: string;
  scanStatus: FileScanStatus;
  visibility: FileVisibility;
  linkedResource: { type: LinkedResourceType; id: string } | null;
  /** Whether the caller could download it right now (scan status + environment). */
  downloadable: boolean;
  isOwner: boolean;
  createdAt: string;
}

/**
 * What travels with a message or announcement: enough to render a card, never a URL or a
 * storage key. A download always goes through `GET /files/:id`, which re-authorizes.
 */
export interface AttachmentDTO {
  id: string;
  name: string;
  mime: string;
  size: number;
  scanStatus: FileScanStatus;
}

export interface FileDownloadDTO {
  file: FileDTO;
  /** A short-lived, user-bound signed URL for the bytes. */
  url: string;
  expiresAt: string;
}
