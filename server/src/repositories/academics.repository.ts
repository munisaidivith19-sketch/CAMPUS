/** Subject, Class and Timetable data access. */
import type { FilterQuery } from 'mongoose';
import { SubjectModel, type SubjectAttrs, type SubjectDocument } from '../models/Subject.model.js';
import { ClassModel, type ClassAttrs, type ClassDocument } from '../models/Class.model.js';
import {
  TimetableModel,
  type TimetableAttrs,
  type TimetableDocument,
} from '../models/Timetable.model.js';
import type { Timestamps } from '../models/base.js';
import {
  TenantRepository,
  requireObjectId,
  toObjectId,
  type IdLike,
  type Page,
  type PageRequest,
} from './base.repository.js';

type SubjectEntity = SubjectAttrs & Timestamps;
type ClassEntity = ClassAttrs & Timestamps;
type TimetableEntity = TimetableAttrs & Timestamps;

class SubjectRepository extends TenantRepository<SubjectEntity> {
  constructor() {
    super(SubjectModel);
  }

  async list(
    institutionId: IdLike,
    page: PageRequest,
    filters: { departmentId?: string } = {},
  ): Promise<Page<SubjectDocument>> {
    const filter: FilterQuery<SubjectEntity> = {};
    if (filters.departmentId) {
      const departmentId = toObjectId(filters.departmentId);
      if (departmentId) filter.departmentId = departmentId;
    }
    return this.pageScoped(institutionId, filter, page, { code: 1 });
  }

  async findById(institutionId: IdLike, id: IdLike): Promise<SubjectDocument | null> {
    return this.findByIdScoped(institutionId, id);
  }

  async findManyByIds(institutionId: IdLike, ids: IdLike[]): Promise<SubjectDocument[]> {
    const objectIds = ids.map((id) => toObjectId(id)).filter((id): id is NonNullable<typeof id> => id !== null);
    if (objectIds.length === 0) return [];
    return SubjectModel.find(this.scoped(institutionId, { _id: { $in: objectIds } })).exec();
  }

  async create(data: {
    institutionId: IdLike;
    code: string;
    name: string;
    credits: number;
    departmentId?: IdLike | null;
  }): Promise<SubjectDocument> {
    return SubjectModel.create({
      institutionId: requireObjectId(data.institutionId),
      code: data.code.toUpperCase(),
      name: data.name,
      credits: data.credits,
      departmentId: data.departmentId ? requireObjectId(data.departmentId) : null,
    });
  }
}

class ClassRepository extends TenantRepository<ClassEntity> {
  constructor() {
    super(ClassModel);
  }

  async findById(institutionId: IdLike, id: IdLike): Promise<ClassDocument | null> {
    return this.findByIdScoped(institutionId, id);
  }

  async list(
    institutionId: IdLike,
    page: PageRequest,
    filters: { departmentId?: string; subjectId?: string; batch?: string; section?: string } = {},
    restrictToIds?: string[] | null,
  ): Promise<Page<ClassDocument>> {
    const filter = this.buildFilter(filters, restrictToIds);
    return this.pageScoped(institutionId, filter, page, { batch: 1, section: 1 });
  }

  /** The faculty scope query: every class this person teaches. */
  async listTaughtBy(institutionId: IdLike, facultyUserId: IdLike): Promise<ClassDocument[]> {
    const faculty = toObjectId(facultyUserId);
    if (!faculty) return [];
    return ClassModel.find(this.scoped(institutionId, { facultyUserId: faculty })).exec();
  }

  async listInSections(
    institutionId: IdLike,
    sections: Array<{ batch: string; section: string }>,
  ): Promise<ClassDocument[]> {
    if (sections.length === 0) return [];
    return ClassModel.find(
      this.scoped(institutionId, {
        $or: sections.map((ref) => ({ batch: ref.batch, section: ref.section.toUpperCase() })),
      } as FilterQuery<ClassEntity>),
    ).exec();
  }

  async listInDepartments(institutionId: IdLike, departmentIds: string[]): Promise<ClassDocument[]> {
    const ids = departmentIds
      .map((id) => toObjectId(id))
      .filter((id): id is NonNullable<typeof id> => id !== null);
    if (ids.length === 0) return [];
    return ClassModel.find(this.scoped(institutionId, { departmentId: { $in: ids } })).exec();
  }

  async listAll(institutionId: IdLike): Promise<ClassDocument[]> {
    return ClassModel.find(this.scoped(institutionId)).exec();
  }

  async findManyByIds(institutionId: IdLike, ids: IdLike[]): Promise<ClassDocument[]> {
    const objectIds = ids.map((id) => toObjectId(id)).filter((id): id is NonNullable<typeof id> => id !== null);
    if (objectIds.length === 0) return [];
    return ClassModel.find(this.scoped(institutionId, { _id: { $in: objectIds } })).exec();
  }

  async create(data: {
    institutionId: IdLike;
    subjectId: IdLike;
    batch: string;
    section: string;
    departmentId?: IdLike | null;
    facultyUserId?: IdLike | null;
  }): Promise<ClassDocument> {
    return ClassModel.create({
      institutionId: requireObjectId(data.institutionId),
      subjectId: requireObjectId(data.subjectId),
      batch: data.batch,
      section: data.section.toUpperCase(),
      departmentId: data.departmentId ? requireObjectId(data.departmentId) : null,
      facultyUserId: data.facultyUserId ? requireObjectId(data.facultyUserId) : null,
    });
  }

  async assignFaculty(
    institutionId: IdLike,
    classId: IdLike,
    facultyUserId: IdLike,
  ): Promise<ClassDocument | null> {
    return ClassModel.findOneAndUpdate(
      { _id: requireObjectId(classId), institutionId: requireObjectId(institutionId) },
      { $set: { facultyUserId: requireObjectId(facultyUserId) } },
      { new: true },
    ).exec();
  }

  private buildFilter(
    filters: { departmentId?: string; subjectId?: string; batch?: string; section?: string },
    restrictToIds?: string[] | null,
  ): FilterQuery<ClassEntity> {
    const filter: FilterQuery<ClassEntity> = {};
    if (filters.departmentId) {
      const departmentId = toObjectId(filters.departmentId);
      if (departmentId) filter.departmentId = departmentId;
    }
    if (filters.subjectId) {
      const subjectId = toObjectId(filters.subjectId);
      if (subjectId) filter.subjectId = subjectId;
    }
    if (filters.batch) filter.batch = filters.batch;
    if (filters.section) filter.section = filters.section.toUpperCase();

    // Scope restriction is applied as an additional constraint, never as a replacement.
    if (restrictToIds) {
      filter._id = {
        $in: restrictToIds
          .map((id) => toObjectId(id))
          .filter((id): id is NonNullable<typeof id> => id !== null),
      };
    }
    return filter;
  }
}

class TimetableRepository extends TenantRepository<TimetableEntity> {
  constructor() {
    super(TimetableModel);
  }

  async findForSection(
    institutionId: IdLike,
    batch: string,
    section: string,
  ): Promise<TimetableDocument | null> {
    return this.findOneScoped(institutionId, { batch, section: section.toUpperCase() });
  }

  async listAll(institutionId: IdLike): Promise<TimetableDocument[]> {
    return TimetableModel.find(this.scoped(institutionId)).exec();
  }

  /** Every timetable containing at least one of these classes — the faculty schedule view. */
  async listContainingClasses(institutionId: IdLike, classIds: IdLike[]): Promise<TimetableDocument[]> {
    const ids = classIds.map((id) => toObjectId(id)).filter((id): id is NonNullable<typeof id> => id !== null);
    if (ids.length === 0) return [];
    return TimetableModel.find(
      this.scoped(institutionId, { 'entries.classId': { $in: ids } } as FilterQuery<TimetableEntity>),
    ).exec();
  }

  async upsertSection(data: {
    institutionId: IdLike;
    batch: string;
    section: string;
    departmentId?: IdLike | null;
    entries: Array<{ day: string; period: number; classId: IdLike; room?: string | null }>;
  }): Promise<TimetableDocument | null> {
    return TimetableModel.findOneAndUpdate(
      {
        institutionId: requireObjectId(data.institutionId),
        batch: data.batch,
        section: data.section.toUpperCase(),
      },
      {
        $set: {
          departmentId: data.departmentId ? requireObjectId(data.departmentId) : null,
          entries: data.entries.map((entry) => ({
            day: entry.day,
            period: entry.period,
            classId: requireObjectId(entry.classId),
            room: entry.room ?? null,
          })),
        },
      },
      { new: true, upsert: true },
    ).exec();
  }
}

export const subjectRepository = new SubjectRepository();
export const classRepository = new ClassRepository();
export const timetableRepository = new TimetableRepository();
