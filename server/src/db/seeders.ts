/**
 * Reusable, idempotent seeding helpers.
 *
 * SYNTHETIC DATA ONLY — never real student PII (a project rule and a git rule). Every helper is
 * an upsert, so the seed can be re-run against an existing database without duplicating rows.
 * The test suite imports these directly to build a tenant, which keeps "what the tests run
 * against" and "what a developer runs against" the same code.
 */
import { ALL_ROLES, ROLE_PERMISSIONS, Role, UserStatus } from '@campusconnect/types';
import { InstitutionModel, type InstitutionDocument } from '../models/Institution.model.js';
import { DepartmentModel, type DepartmentDocument } from '../models/Department.model.js';
import { UserModel, type UserDocument } from '../models/User.model.js';
import { roleRepository, permissionRepository } from '../repositories/rbac.repository.js';
import {
  studentProfileRepository,
  facultyProfileRepository,
} from '../repositories/profile.repository.js';
import { studentIdRepository } from '../repositories/studentId.repository.js';
import { PERMISSION_CATALOG } from '../policies/permissionCatalog.js';
import { hashPassword } from '../services/password.service.js';
import { invalidateRbacCache } from '../services/rbac.service.js';
import type { IdLike } from '../repositories/base.repository.js';

export async function ensureInstitution(data: {
  name: string;
  slug: string;
  domains: string[];
}): Promise<InstitutionDocument> {
  const existing = await InstitutionModel.findOne({ slug: data.slug }).exec();
  if (existing) return existing;

  return InstitutionModel.create({
    name: data.name,
    slug: data.slug,
    domains: data.domains.map((d) => d.toLowerCase()),
    branding: {},
    storageQuotaBytes: 5_368_709_120,
    status: 'ACTIVE',
  });
}

/** Seed the permission catalog and all 14 platform roles with their grants. */
export async function ensureRolesAndPermissions(institutionId: IdLike): Promise<void> {
  for (const entry of PERMISSION_CATALOG) {
    await permissionRepository.upsert(institutionId, entry.key, entry.description);
  }

  for (const role of ALL_ROLES) {
    const label = role
      .split('_')
      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
      .join(' ');
    await roleRepository.upsert(institutionId, role, label, ROLE_PERMISSIONS[role]);
  }

  // The cache may hold a pre-seed (empty) map for this tenant.
  invalidateRbacCache(String(institutionId));
}

export async function ensureDepartment(
  institutionId: IdLike,
  name: string,
  code: string,
): Promise<DepartmentDocument> {
  const existing = await DepartmentModel.findOne({
    institutionId,
    code: code.toUpperCase(),
  }).exec();
  if (existing) return existing;
  return DepartmentModel.create({ institutionId, name, code: code.toUpperCase() });
}

export async function ensureUser(data: {
  institutionId: IdLike;
  email: string;
  password: string;
  fullName: string;
  roles: Role[];
  primaryRole: Role;
  status?: UserStatus;
}): Promise<UserDocument> {
  const email = data.email.toLowerCase();
  const existing = await UserModel.findOne({ institutionId: data.institutionId, email }).exec();
  if (existing) return existing;

  return UserModel.create({
    institutionId: data.institutionId,
    email,
    passwordHash: await hashPassword(data.password),
    fullName: data.fullName,
    // Seeded accounts skip email verification so they are immediately usable.
    status: data.status ?? UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    roles: data.roles,
    primaryRole: data.primaryRole,
  });
}

export interface SeededCredential {
  role: Role;
  email: string;
  password: string;
}

export interface SeedResult {
  institution: InstitutionDocument;
  credentials: SeededCredential[];
}

/**
 * The full development dataset: one institution, three departments, the RBAC catalog, and one
 * user per key role — plus a student profile and an issued digital ID so the QR flow is
 * demonstrable end to end.
 */
export async function seedDevelopmentData(domain = 'jnn.edu.in'): Promise<SeedResult> {
  const institution = await ensureInstitution({
    name: 'JNN College of Engineering',
    slug: 'jnn',
    domains: [domain],
  });
  const institutionId = institution._id;

  await ensureRolesAndPermissions(institutionId);

  const cse = await ensureDepartment(institutionId, 'Computer Science & Engineering', 'CSE');
  await ensureDepartment(institutionId, 'Electronics & Communication', 'ECE');
  await ensureDepartment(institutionId, 'Mechanical Engineering', 'MECH');

  const accounts: Array<{ role: Role; email: string; password: string; fullName: string }> = [
    {
      role: Role.STUDENT,
      email: `asha.student@${domain}`,
      password: 'StudentPass#2026',
      fullName: 'Asha Rao',
    },
    {
      role: Role.FACULTY,
      email: `vikram.faculty@${domain}`,
      password: 'FacultyPass#2026',
      fullName: 'Vikram Iyer',
    },
    {
      role: Role.CLASS_MENTOR,
      email: `meera.mentor@${domain}`,
      password: 'MentorPass#2026',
      fullName: 'Meera Nair',
    },
    {
      role: Role.HOD,
      email: `rajesh.hod@${domain}`,
      password: 'HodPass#2026',
      fullName: 'Rajesh Kumar',
    },
    {
      role: Role.PRINCIPAL,
      email: `principal@${domain}`,
      password: 'PrincipalPass#2026',
      fullName: 'Lakshmi Menon',
    },
    {
      role: Role.SYSTEM_ADMIN,
      email: `admin@${domain}`,
      password: 'AdminPass#2026',
      fullName: 'System Administrator',
    },
  ];

  const credentials: SeededCredential[] = [];
  const users = new Map<Role, UserDocument>();

  for (const account of accounts) {
    const user = await ensureUser({
      institutionId,
      email: account.email,
      password: account.password,
      fullName: account.fullName,
      roles: [account.role],
      primaryRole: account.role,
    });
    users.set(account.role, user);
    credentials.push({ role: account.role, email: account.email, password: account.password });
  }

  // Role profiles.
  const student = users.get(Role.STUDENT);
  if (student && !(await studentProfileRepository.findByUserId(institutionId, student._id))) {
    await studentProfileRepository.create({
      institutionId,
      userId: student._id,
      rollNo: '1JN22CS001',
      departmentId: cse._id,
      batch: '2022-2026',
      year: 4,
      section: 'A',
    });
  }

  for (const role of [Role.FACULTY, Role.CLASS_MENTOR, Role.HOD]) {
    const staff = users.get(role);
    if (staff && !(await facultyProfileRepository.findByUserId(institutionId, staff._id))) {
      await facultyProfileRepository.create({
        institutionId,
        userId: staff._id,
        departmentId: cse._id,
        designation: role === Role.HOD ? 'Head of Department' : 'Assistant Professor',
        subjectsTaught: ['Data Structures', 'Operating Systems'],
      });
    }
  }

  // An issued digital ID so /me/student-id and the QR flow work straight after seeding.
  const admin = users.get(Role.SYSTEM_ADMIN);
  if (
    student &&
    admin &&
    !(await studentIdRepository.findActiveForUser(institutionId, student._id))
  ) {
    const profile = await studentProfileRepository.findByUserId(institutionId, student._id);
    if (profile) {
      await studentIdRepository.create({
        institutionId,
        studentProfileId: profile._id,
        userId: student._id,
        cardNo: '1JN22CS001-0001',
        validFrom: new Date(),
        validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        issuedByUserId: admin._id,
      });
    }
  }

  // Phase 3: academics + community data on top of the identity baseline.
  const { seedAcademicsAndCommunity } = await import('./seeders.academics.js');
  await seedAcademicsAndCommunity(institution);

  // Phase 3 Part C-3: a demo attachment on a seeded announcement.
  const { seedFiles } = await import('./seeders.files.js');
  await seedFiles(institution);

  // A second, tiny synthetic institution, so tenant isolation can be demonstrated live: its
  // student can sign in, but every id from the first institution is NOT_FOUND to them.
  const other = await ensureInstitution({
    name: 'Riverside Institute of Technology (synthetic)',
    slug: 'riverside-demo',
    domains: ['riverside.test'],
  });
  await ensureRolesAndPermissions(other._id);
  const otherStudent = {
    role: Role.STUDENT,
    email: 'ravi.student@riverside.test',
    password: 'OtherTenantPass#2026',
    fullName: 'Ravi Shetty',
  };
  await ensureUser({
    institutionId: other._id,
    email: otherStudent.email,
    password: otherStudent.password,
    fullName: otherStudent.fullName,
    roles: [otherStudent.role],
    primaryRole: otherStudent.role,
  });
  credentials.push({
    role: otherStudent.role,
    email: otherStudent.email,
    password: otherStudent.password,
  });

  return { institution, credentials };
}
