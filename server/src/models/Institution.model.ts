/**
 * Institution — the tenant itself. [global] collection: it is the tenant registry, so it is the
 * one identity-slice collection without an `institutionId` of its own.
 *
 * `domains` is the lookup key used at registration: an institution email's domain resolves the
 * tenant, so a client never chooses (or can forge) its own tenant.
 */
import { Schema, type HydratedDocument } from 'mongoose';
import { defineModel, type Timestamps } from './base.js';

export interface InstitutionAttrs {
  name: string;
  slug: string;
  domains: string[];
  branding: { logoUrl?: string; primaryColor?: string; accentColor?: string };
  storageQuotaBytes: number;
  status: 'ACTIVE' | 'SUSPENDED';
}

const institutionSchema = new Schema<InstitutionAttrs & Timestamps>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 80 },
    // Lower-cased on write so domain matching is exact and case-insensitive.
    domains: {
      type: [{ type: String, lowercase: true, trim: true }],
      required: true,
      validate: [(v: string[]) => v.length > 0, 'At least one domain is required'],
    },
    branding: {
      logoUrl: { type: String },
      primaryColor: { type: String },
      accentColor: { type: String },
    },
    storageQuotaBytes: { type: Number, required: true, default: 5_368_709_120 },
    status: { type: String, required: true, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  },
  { timestamps: true },
);

institutionSchema.index({ domains: 1 }, { unique: true });

export type InstitutionDocument = HydratedDocument<InstitutionAttrs & Timestamps>;
export const InstitutionModel = defineModel<InstitutionAttrs & Timestamps>('Institution', institutionSchema);
