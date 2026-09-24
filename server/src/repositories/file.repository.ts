/**
 * File metadata access.
 *
 * Every method is tenant-scoped through `TenantRepository.scoped`. The state transitions that
 * matter for security — linking a file to a resource, and claiming an orphan for deletion — are
 * single conditional updates, so two requests (or two cleanup workers) racing on one file cannot
 * both win.
 */
import { Types, type FilterQuery } from 'mongoose';
import { FileVisibility, type FileScanStatus, type LinkedResourceType } from '@campusconnect/types';
import { FileModel, type FileAttrs, type FileDocument } from '../models/File.model.js';
import type { Timestamps } from '../models/base.js';
import { TenantRepository, requireObjectId, toObjectId, type IdLike } from './base.repository.js';

type FileEntity = FileAttrs & Timestamps;

export interface NewFileRow {
  ownerUserId: IdLike;
  storageKey: string;
  originalName: string;
  extension: string;
  mime: string;
  size: number;
  checksum: string;
  scanStatus: FileScanStatus;
  scanSignature?: string | null;
}

export interface ResourceRef {
  type: LinkedResourceType;
  id: IdLike;
  contextId?: IdLike | null;
}

class FileRepository extends TenantRepository<FileEntity> {
  constructor() {
    super(FileModel);
  }

  async create(institutionId: IdLike, row: NewFileRow): Promise<FileDocument> {
    return FileModel.create({
      institutionId: requireObjectId(institutionId),
      ownerUserId: requireObjectId(row.ownerUserId),
      storageKey: row.storageKey,
      originalName: row.originalName,
      extension: row.extension,
      mime: row.mime,
      size: row.size,
      checksum: row.checksum,
      scanStatus: row.scanStatus,
      scanSignature: row.scanSignature ?? null,
      visibility: FileVisibility.PRIVATE,
    });
  }

  /** A live (not deleted) file by id, within the tenant. */
  async findLive(institutionId: IdLike, id: IdLike): Promise<FileDocument | null> {
    const objectId = toObjectId(id);
    if (!objectId) return null;
    return this.findOneScoped(institutionId, {
      _id: objectId,
      deletedAt: null,
    } as FilterQuery<FileEntity>);
  }

  async findLiveMany(institutionId: IdLike, ids: readonly IdLike[]): Promise<FileDocument[]> {
    const objectIds = ids
      .map((id) => toObjectId(id))
      .filter((id): id is Types.ObjectId => id !== null);
    if (objectIds.length === 0) return [];
    return FileModel.find(
      this.scoped(institutionId, {
        _id: { $in: objectIds },
        deletedAt: null,
      } as FilterQuery<FileEntity>),
    ).exec();
  }

  /** Live files attached to any of the given resources of one type, in upload order. */
  async listForResources(
    institutionId: IdLike,
    type: LinkedResourceType,
    resourceIds: readonly IdLike[],
  ): Promise<FileDocument[]> {
    const ids = resourceIds
      .map((id) => toObjectId(id))
      .filter((id): id is Types.ObjectId => id !== null);
    if (ids.length === 0) return [];
    return FileModel.find(
      this.scoped(institutionId, {
        'linkedResource.type': type,
        'linkedResource.id': { $in: ids },
        deletedAt: null,
      } as FilterQuery<FileEntity>),
    )
      .sort({ createdAt: 1 })
      .exec();
  }

  /** Bytes the owner currently holds in live files — the quota measure. */
  async usedBytes(institutionId: IdLike, ownerUserId: IdLike): Promise<number> {
    const [row] = await FileModel.aggregate<{ total: number }>([
      {
        $match: this.scoped(institutionId, {
          ownerUserId: requireObjectId(ownerUserId),
          deletedAt: null,
        } as FilterQuery<FileEntity>),
      },
      { $group: { _id: null, total: { $sum: '$size' } } },
    ]).exec();
    return row?.total ?? 0;
  }

  /**
   * Link the caller's own files to a resource, all or nothing.
   *
   * Each file is claimed with one conditional update that re-states every precondition — same
   * tenant, same owner, still private, not deleted, a linkable scan status — so a file that was
   * linked elsewhere a moment ago, or that belongs to someone else, simply does not match. If
   * any file fails to claim, the ones already claimed are released and the call reports failure.
   */
  async linkAll(
    institutionId: IdLike,
    ownerUserId: IdLike,
    fileIds: readonly IdLike[],
    resource: ResourceRef,
    linkableStatuses: readonly FileScanStatus[],
  ): Promise<boolean> {
    const claimed: Types.ObjectId[] = [];
    const linkedResource = {
      type: resource.type,
      id: requireObjectId(resource.id),
      contextId: resource.contextId ? requireObjectId(resource.contextId) : null,
    };

    for (const id of fileIds) {
      const objectId = toObjectId(id);
      if (!objectId) break;
      const modified = await this.updateOneScoped(
        institutionId,
        {
          _id: objectId,
          ownerUserId: requireObjectId(ownerUserId),
          visibility: FileVisibility.PRIVATE,
          deletedAt: null,
          scanStatus: { $in: [...linkableStatuses] },
        } as FilterQuery<FileEntity>,
        { $set: { visibility: FileVisibility.LINKED, linkedResource, linkedAt: new Date() } },
      );
      if (modified !== 1) break;
      claimed.push(objectId);
    }

    if (claimed.length === fileIds.length) return true;

    await this.unlinkMany(institutionId, claimed, resource);
    return false;
  }

  /** Release files claimed for a resource that was never created. */
  async unlinkMany(
    institutionId: IdLike,
    fileIds: readonly IdLike[],
    resource: ResourceRef,
  ): Promise<void> {
    if (fileIds.length === 0) return;
    await this.updateManyScoped(
      institutionId,
      {
        _id: { $in: fileIds.map((id) => requireObjectId(id)) },
        'linkedResource.type': resource.type,
        'linkedResource.id': requireObjectId(resource.id),
      } as FilterQuery<FileEntity>,
      { $set: { visibility: FileVisibility.PRIVATE, linkedResource: null, linkedAt: null } },
    );
  }

  /**
   * Mark one live file deleted and return it, so the caller knows it (and only it) should remove
   * the bytes. A second caller racing on the same file gets null.
   */
  async claimDeletion(
    institutionId: IdLike,
    filter: FilterQuery<FileEntity>,
    deletedByUserId: IdLike | null,
    reason: string,
  ): Promise<FileDocument | null> {
    return FileModel.findOneAndUpdate(
      this.scoped(institutionId, { ...filter, deletedAt: null } as FilterQuery<FileEntity>),
      {
        $set: {
          deletedAt: new Date(),
          deletedByUserId: deletedByUserId ? requireObjectId(deletedByUserId) : null,
          deletedReason: reason,
        },
      },
      { new: true },
    ).exec();
  }

  /** Ids of unlinked live files older than `cutoff` — orphan-cleanup candidates. */
  async listOrphanIds(
    institutionId: IdLike,
    cutoff: Date,
    limit: number,
  ): Promise<Types.ObjectId[]> {
    const rows = await FileModel.find(
      this.scoped(institutionId, {
        visibility: FileVisibility.PRIVATE,
        createdAt: { $lt: cutoff },
        deletedAt: null,
      } as FilterQuery<FileEntity>),
    )
      .select('_id')
      .limit(limit)
      .lean()
      .exec();
    return rows.map((row) => row._id as Types.ObjectId);
  }
}

export const fileRepository = new FileRepository();
