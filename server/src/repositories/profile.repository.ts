/** Student and faculty profile data access (the role-specific half of an identity). */
import {
  StudentProfileModel,
  type StudentProfileAttrs,
  type StudentProfileDocument,
} from '../models/StudentProfile.model.js';
import {
  FacultyProfileModel,
  type FacultyProfileAttrs,
  type FacultyProfileDocument,
} from '../models/FacultyProfile.model.js';
import type { Timestamps } from '../models/base.js';
import { TenantRepository, requireObjectId, toObjectId, type IdLike } from './base.repository.js';

type StudentProfileEntity = StudentProfileAttrs & Timestamps;
type FacultyProfileEntity = FacultyProfileAttrs & Timestamps;

class StudentProfileRepository extends TenantRepository<StudentProfileEntity> {
  constructor() {
    super(StudentProfileModel);
  }

  async findByUserId(institutionId: IdLike, userId: IdLike): Promise<StudentProfileDocument | null> {
    const user = toObjectId(userId);
    if (!user) return null;
    return this.findOneScoped(institutionId, { userId: user });
  }

  async findByRollNo(institutionId: IdLike, rollNo: string): Promise<StudentProfileDocument | null> {
    return this.findOneScoped(institutionId, { rollNo: rollNo.toUpperCase() });
  }

  async create(data: {
    institutionId: IdLike;
    userId: IdLike;
    rollNo: string;
    departmentId?: IdLike | null;
    batch?: string | null;
    year?: number | null;
    section?: string | null;
  }): Promise<StudentProfileDocument> {
    return StudentProfileModel.create({
      institutionId: requireObjectId(data.institutionId),
      userId: requireObjectId(data.userId),
      rollNo: data.rollNo.toUpperCase(),
      departmentId: data.departmentId ? requireObjectId(data.departmentId) : null,
      batch: data.batch ?? null,
      year: data.year ?? null,
      section: data.section ?? null,
    });
  }

  /** Allowlisted self-service fields only — roll number and department are administrative. */
  async update(
    institutionId: IdLike,
    userId: IdLike,
    fields: { batch?: string; year?: number; section?: string },
  ): Promise<StudentProfileDocument | null> {
    const $set: Record<string, unknown> = {};
    if (fields.batch !== undefined) $set.batch = fields.batch;
    if (fields.year !== undefined) $set.year = fields.year;
    if (fields.section !== undefined) $set.section = fields.section;
    if (Object.keys($set).length === 0) return this.findByUserId(institutionId, userId);
    return StudentProfileModel.findOneAndUpdate(
      { institutionId: requireObjectId(institutionId), userId: requireObjectId(userId) },
      { $set },
      { new: true },
    ).exec();
  }
}

class FacultyProfileRepository extends TenantRepository<FacultyProfileEntity> {
  constructor() {
    super(FacultyProfileModel);
  }

  async findByUserId(institutionId: IdLike, userId: IdLike): Promise<FacultyProfileDocument | null> {
    const user = toObjectId(userId);
    if (!user) return null;
    return this.findOneScoped(institutionId, { userId: user });
  }

  async create(data: {
    institutionId: IdLike;
    userId: IdLike;
    departmentId?: IdLike | null;
    designation?: string | null;
    subjectsTaught?: string[];
  }): Promise<FacultyProfileDocument> {
    return FacultyProfileModel.create({
      institutionId: requireObjectId(data.institutionId),
      userId: requireObjectId(data.userId),
      departmentId: data.departmentId ? requireObjectId(data.departmentId) : null,
      designation: data.designation ?? null,
      subjectsTaught: data.subjectsTaught ?? [],
    });
  }

  async update(
    institutionId: IdLike,
    userId: IdLike,
    fields: { designation?: string; subjectsTaught?: string[] },
  ): Promise<FacultyProfileDocument | null> {
    const $set: Record<string, unknown> = {};
    if (fields.designation !== undefined) $set.designation = fields.designation;
    if (fields.subjectsTaught !== undefined) $set.subjectsTaught = fields.subjectsTaught;
    if (Object.keys($set).length === 0) return this.findByUserId(institutionId, userId);
    return FacultyProfileModel.findOneAndUpdate(
      { institutionId: requireObjectId(institutionId), userId: requireObjectId(userId) },
      { $set },
      { new: true },
    ).exec();
  }
}

export const studentProfileRepository = new StudentProfileRepository();
export const facultyProfileRepository = new FacultyProfileRepository();
