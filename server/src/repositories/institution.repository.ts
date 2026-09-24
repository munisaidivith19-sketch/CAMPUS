/**
 * Institution + Department data access.
 *
 * `Institution` is the [global] tenant registry, so it is the one collection here that is not
 * tenant-scoped — it IS the tenant list. Resolving an institution from an email domain is what
 * lets registration derive the tenant server-side instead of trusting the client to name it.
 */
import { InstitutionModel, type InstitutionDocument } from '../models/Institution.model.js';
import {
  DepartmentModel,
  type DepartmentAttrs,
  type DepartmentDocument,
} from '../models/Department.model.js';
import type { Timestamps } from '../models/base.js';
import { TenantRepository, requireObjectId, toObjectId, type IdLike } from './base.repository.js';

type DepartmentEntity = DepartmentAttrs & Timestamps;

class InstitutionRepository {
  /** The tenant lookup used at registration/login: derived from the email domain, never a header. */
  async findByDomain(domain: string): Promise<InstitutionDocument | null> {
    return InstitutionModel.findOne({ domains: domain.toLowerCase(), status: 'ACTIVE' }).exec();
  }

  async findById(id: IdLike): Promise<InstitutionDocument | null> {
    const objectId = toObjectId(id);
    if (!objectId) return null;
    return InstitutionModel.findById(objectId).exec();
  }

  /**
   * Every institution id. For platform maintenance jobs (orphan-file cleanup) that then work
   * tenant by tenant through the scoped repositories — never for serving a request.
   */
  async listIds(): Promise<string[]> {
    const rows = await InstitutionModel.find({}).select('_id').lean().exec();
    return rows.map((row) => String(row._id));
  }

  async findBySlug(slug: string): Promise<InstitutionDocument | null> {
    return InstitutionModel.findOne({ slug: slug.toLowerCase() }).exec();
  }
}

class DepartmentRepository extends TenantRepository<DepartmentEntity> {
  constructor() {
    super(DepartmentModel);
  }

  async listForInstitution(institutionId: IdLike): Promise<DepartmentDocument[]> {
    return DepartmentModel.find(this.scoped(institutionId)).sort({ code: 1 }).exec();
  }

  async findByCode(institutionId: IdLike, code: string): Promise<DepartmentDocument | null> {
    return this.findOneScoped(institutionId, { code: code.toUpperCase() });
  }

  /** The departments this user heads — the source of an HOD's academic scope. */
  async listHeadedBy(institutionId: IdLike, hodUserId: IdLike): Promise<DepartmentDocument[]> {
    const hod = toObjectId(hodUserId);
    if (!hod) return [];
    return DepartmentModel.find(this.scoped(institutionId, { hodUserId: hod })).exec();
  }

  async findById(institutionId: IdLike, id: IdLike): Promise<DepartmentDocument | null> {
    return this.findByIdScoped(institutionId, id);
  }

  async setHod(institutionId: IdLike, departmentId: IdLike, hodUserId: IdLike): Promise<void> {
    await this.updateOneScoped(
      institutionId,
      { _id: requireObjectId(departmentId) },
      { $set: { hodUserId: requireObjectId(hodUserId) } },
    );
  }
}

export const institutionRepository = new InstitutionRepository();
export const departmentRepository = new DepartmentRepository();
