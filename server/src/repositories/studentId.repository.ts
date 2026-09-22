/** Digital student ID card data access. */
import { StudentIdStatus } from '@campusconnect/types';
import { StudentIDModel, type StudentIDAttrs, type StudentIDDocument } from '../models/StudentID.model.js';
import type { Timestamps } from '../models/base.js';
import { TenantRepository, requireObjectId, toObjectId, type IdLike } from './base.repository.js';

type StudentIDEntity = StudentIDAttrs & Timestamps;

class StudentIdRepository extends TenantRepository<StudentIDEntity> {
  constructor() {
    super(StudentIDModel);
  }

  async findActiveForUser(institutionId: IdLike, userId: IdLike): Promise<StudentIDDocument | null> {
    const user = toObjectId(userId);
    if (!user) return null;
    return this.findOneScoped(institutionId, {
      userId: user,
      status: StudentIdStatus.ACTIVE,
      validTo: { $gt: new Date() },
    });
  }

  async create(data: {
    institutionId: IdLike;
    studentProfileId: IdLike;
    userId: IdLike;
    cardNo: string;
    validFrom: Date;
    validTo: Date;
    issuedByUserId: IdLike;
  }): Promise<StudentIDDocument> {
    return StudentIDModel.create({
      institutionId: requireObjectId(data.institutionId),
      studentProfileId: requireObjectId(data.studentProfileId),
      userId: requireObjectId(data.userId),
      cardNo: data.cardNo.toUpperCase(),
      validFrom: data.validFrom,
      validTo: data.validTo,
      status: StudentIdStatus.ACTIVE,
      issuedByUserId: requireObjectId(data.issuedByUserId),
    });
  }

  async revokeForUser(institutionId: IdLike, userId: IdLike): Promise<number> {
    return this.updateManyScoped(
      institutionId,
      { userId: requireObjectId(userId), status: StudentIdStatus.ACTIVE },
      { $set: { status: StudentIdStatus.REVOKED } },
    );
  }

  async countForInstitution(institutionId: IdLike): Promise<number> {
    return this.countScoped(institutionId);
  }
}

export const studentIdRepository = new StudentIdRepository();
