/** Profile, role-management and QR request schemas (Phase 2). */
import { z } from 'zod';
import { Role } from '@campusconnect/types';
import { objectIdSchema } from './common.js';
import { fullNameSchema, opaqueTokenSchema } from './auth.js';

/** Indian mobile numbers in the synthetic dataset; kept permissive but bounded. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[+]?[\d ()-]{7,20}$/, 'Enter a valid phone number');

export const updateMeSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update',
  });
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const updateStudentProfileSchema = z
  .object({
    batch: z.string().trim().max(20).optional(),
    year: z.coerce.number().int().min(1).max(6).optional(),
    section: z.string().trim().max(10).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update',
  });

export const updateFacultyProfileSchema = z
  .object({
    designation: z.string().trim().max(80).optional(),
    subjectsTaught: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update',
  });

/**
 * Role assignment (SYSTEM_ADMIN only). `primaryRole` must be one of `roles` — checked here so
 * an inconsistent pair can never reach the service.
 */
export const assignRolesSchema = z
  .object({
    roles: z.array(z.nativeEnum(Role)).min(1, 'At least one role is required').max(14),
    primaryRole: z.nativeEnum(Role),
  })
  .refine((v) => v.roles.includes(v.primaryRole), {
    message: 'primaryRole must be one of the assigned roles',
    path: ['primaryRole'],
  });
export type AssignRolesInput = z.infer<typeof assignRolesSchema>;

export const userIdParamSchema = z.object({ id: objectIdSchema });

/** QR verification: the scanner submits only the opaque token it read. */
export const qrVerifySchema = z.object({ token: opaqueTokenSchema });

export const issueStudentIdSchema = z.object({
  userId: objectIdSchema,
  /** Optional validity window end; defaults to the institution's academic default server-side. */
  validTo: z.coerce.date().optional(),
});
