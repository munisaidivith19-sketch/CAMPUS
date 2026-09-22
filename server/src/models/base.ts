/**
 * Shared model primitives.
 *
 * Every tenant-scoped collection carries `institutionId` and leads its compound indexes with it
 * (ADR-0005 / docs/architecture/06-multi-tenancy.md). Only collections explicitly marked
 * [global] in docs/database/DATABASE.md may omit it.
 */
import { Schema, type Types } from 'mongoose';

export interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

/** The tenant key definition, reused verbatim so it can never be declared inconsistently. */
export const tenantKey = {
  type: Schema.Types.ObjectId,
  ref: 'Institution',
  required: true,
  index: true,
} as const;

export type ObjectId = Types.ObjectId;
