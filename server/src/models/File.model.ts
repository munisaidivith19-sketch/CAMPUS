/**
 * File — metadata for one uploaded file. The bytes live behind the storage abstraction
 * (`infra/storage/`), addressed by `storageKey`; nothing here is ever derived from the name the
 * client sent.
 *
 * Access is not stored on the file. A PRIVATE file is its owner's alone; a LINKED file is
 * readable by whoever can read `linkedResource` — the check is delegated to that resource's own
 * rules at read time, so losing access to a chat loses access to its attachments immediately.
 *
 * Deletion is soft for the metadata (history and audit keep making sense) and hard for the
 * bytes, which are removed from storage when the row is marked deleted.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { FileScanStatus, FileVisibility, LinkedResourceType } from '@campusconnect/types';
import { defineModel, tenantKey, type ObjectId, type Timestamps } from './base.js';

export interface LinkedResource {
  type: LinkedResourceType;
  id: ObjectId;
  /**
   * The container the resource lives in, when its read check needs one — the chat of a chat
   * message. Saves a lookup and is re-verified, never trusted, at read time.
   */
  contextId?: ObjectId | null;
}

export interface FileAttrs {
  institutionId: ObjectId;
  ownerUserId: ObjectId;
  storageKey: string;
  /** Sanitized display name: no path parts, control or bidi characters, capped length. */
  originalName: string;
  /** The verified extension (from the bytes, agreeing with the declared name). */
  extension: string;
  /** The verified MIME type — what the bytes are, not what the client claimed. */
  mime: string;
  size: number;
  /** Hex SHA-256, computed while streaming. */
  checksum: string;
  scanStatus: FileScanStatus;
  /** The scanner's signature name for an INFECTED file. Never file content. */
  scanSignature?: string | null;
  visibility: FileVisibility;
  linkedResource?: LinkedResource | null;
  linkedAt?: Date | null;
  deletedAt?: Date | null;
  deletedByUserId?: ObjectId | null;
  /** Why it was deleted: OWNER, MODERATOR, RESOURCE_DELETED, ORPHAN, MALWARE. */
  deletedReason?: string | null;
}

const linkedResourceSchema = new Schema<LinkedResource>(
  {
    type: { type: String, required: true, enum: Object.values(LinkedResourceType) },
    id: { type: Schema.Types.ObjectId, required: true },
    contextId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const fileSchema = new Schema<FileAttrs & Timestamps>(
  {
    institutionId: tenantKey,
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    storageKey: { type: String, required: true },
    originalName: { type: String, required: true, maxlength: 255 },
    extension: { type: String, required: true, maxlength: 10 },
    mime: { type: String, required: true, maxlength: 255 },
    size: { type: Number, required: true, min: 0 },
    checksum: { type: String, required: true, match: /^[a-f\d]{64}$/ },
    scanStatus: {
      type: String,
      required: true,
      enum: Object.values(FileScanStatus),
      default: FileScanStatus.PENDING,
    },
    scanSignature: { type: String, default: null, maxlength: 200 },
    visibility: {
      type: String,
      required: true,
      enum: Object.values(FileVisibility),
      default: FileVisibility.PRIVATE,
    },
    linkedResource: { type: linkedResourceSchema, default: null },
    linkedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    deletedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedReason: { type: String, default: null, maxlength: 40 },
  },
  { timestamps: true },
);

/** "My files", and the owner's storage usage for the quota check. */
fileSchema.index({ institutionId: 1, ownerUserId: 1, createdAt: -1 });
/** A resource's attachments: loading a message's or announcement's files in one query. */
fileSchema.index({ institutionId: 1, 'linkedResource.type': 1, 'linkedResource.id': 1 });
/** Orphan cleanup: unlinked, undeleted files older than the TTL, per tenant. */
fileSchema.index({ institutionId: 1, visibility: 1, createdAt: 1 });
/** One row per stored object; the key already carries the tenant prefix. */
fileSchema.index({ institutionId: 1, storageKey: 1 }, { unique: true });

export type FileDocument = HydratedDocument<FileAttrs & Timestamps>;
export const FileModel = defineModel<FileAttrs & Timestamps>('File', fileSchema);
