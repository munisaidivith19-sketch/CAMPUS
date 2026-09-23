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

  /**
   * The roster for a section — the structural answer to "who is in this class".
   *
   * `departmentId` is optional because a section is already unique within a batch in practice;
   * passing it narrows further when an institution reuses section letters across departments.
   */
  async listBySection(
    institutionId: IdLike,
    batch: string,
    section: string,
    departmentId?: IdLike | null,
  ): Promise<StudentProfileDocument[]> {
    const filter: Record<string, unknown> = { batch, section: section.toUpperCase() };
    if (departmentId) {
      const department = toObjectId(departmentId);
      if (department) filter.departmentId = department;
    }
    return StudentProfileModel.find(this.scoped(institutionId, filter)).sort({ rollNo: 1 }).exec();
  }

  async listByDepartment(institutionId: IdLike, departmentId: IdLike): Promise<StudentProfileDocument[]> {
    const department = toObjectId(departmentId);
    if (!department) return [];
    return StudentProfileModel.find(this.scoped(institutionId, { departmentId: department }))
      .sort({ rollNo: 1 })
      .exec();
  }

  async listAll(institutionId: IdLike): Promise<StudentProfileDocument[]> {
    return StudentProfileModel.find(this.scoped(institutionId)).sort({ rollNo: 1 }).exec();
  }

  async findManyByUserIds(institutionId: IdLike, userIds: IdLike[]): Promise<StudentProfileDocument[]> {
    const ids = userIds
      .map((id) => toObjectId(id))
      .filter((id): id is NonNullable<ReturnType<typeof toObjectId>> => id !== null);
    if (ids.length === 0) return [];
    return StudentProfileModel.find(this.scoped(institutionId, { userId: { $in: ids } })).exec();
  }

  async setInterests(
    institutionId: IdLike,
    userId: IdLike,
    interests: string[],
  ): Promise<StudentProfileDocument | null> {
    return StudentProfileModel.findOneAndUpdate(
      { institutionId: requireObjectId(institutionId), userId: requireObjectId(userId) },
      { $set: { interests: interests.map((i) => i.toLowerCase()) } },
      { new: true },
    ).exec();
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

  /** Assign the section a CLASS_MENTOR is responsible for (used by the seed and admin tooling). */
  async setMentorSection(
    institutionId: IdLike,
    userId: IdLike,
    mentorOf: { batch: string; section: string } | null,
  ): Promise<FacultyProfileDocument | null> {
    return FacultyProfileModel.findOneAndUpdate(
      { institutionId: requireObjectId(institutionId), userId: requireObjectId(userId) },
      {
        $set: {
          mentorOf: mentorOf ? { batch: mentorOf.batch, section: mentorOf.section.toUpperCase() } : null,
        },
      },
      { new: true },
    ).exec();
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
