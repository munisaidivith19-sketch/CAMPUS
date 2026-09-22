# Database Architecture (MongoDB / Mongoose)

MongoDB is the sole primary datastore (ADR-0001). This document is the frozen data model for the
whole platform. **Phase 1 defines shapes and relationships only** — models are implemented phase
by phase. Nothing here is code yet; it is the contract the code will follow.

## Conventions

- **IDs:** MongoDB `ObjectId`. References use `ObjectId` + `ref`.
- **Tenant key:** every tenant-scoped document has an indexed `institutionId` (ADR-0005).
  Platform-global collections are marked **[global]**.
- **Timestamps:** all documents use `createdAt` / `updatedAt` (Mongoose `timestamps: true`).
- **Soft delete:** where history matters, `deletedAt` (nullable) instead of hard delete.
- **Embed vs. reference:** embed data that is owned-by and read-with the parent and is bounded in
  size; reference data that is shared, independently queried, or unbounded/growing.
- **Validation:** Mongoose schema validation is the last line; Zod validates at the API boundary
  first (`packages/validation`).
- **Enums** (roles, statuses) live in `@campusconnect/types` and are referenced by both DB and API.

## Modeling decisions (the "why")

| Decision | Rationale |
| -------- | --------- |
| **Separate `User` from role `*Profile` documents** (`StudentProfile`, `FacultyProfile`, `AlumniProfile`) | `User` holds identity/auth common to everyone; role profiles hold role-specific fields and grow independently. Keeps the auth-critical doc small and fast. |
| **`Role`/`Permission` as data, not just enums** | Enables adding roles/permissions later without code changes; supports resource- and ABAC-style rules. A cached role→permission map is used at runtime. |
| **`Attendance` as one document per (student, session/period)** | Enables correct aggregation (`total present / total records`), never averaging percentages; supports the correction+audit workflow. |
| **Chat split into `Chat` / `ChatMembership` / `ChatMessage`** | Memberships are queried independently (who's in a room, unread counts); messages are unbounded and must be referenced, never embedded. |
| **One reusable `PermissionRequest` + workflow, not per-module approvals** | Gate pass, hostel leave/outing, event/academic permissions share one approval engine (see API doc). Avoids duplicated workflow logic. |
| **QR verification via `QRToken`, never PII in the QR** | The QR carries an opaque, short-lived/revocable token id; the server resolves identity. |
| **`AuditLog` append-only** | Immutable trail for sensitive/admin actions; never stores secrets/OTPs/plaintext. |
| **Career data split** (`CareerProfile`, `Skill`, `StudentSkill`, `Project`, `Certification`, `CareerGoal`, `SkillGap`, `CareerRoadmap`) | Skills are shared taxonomy; a student's skills/projects/certs are independently listed and matched against jobs. |

## Model catalog

Grouped by domain. Key fields and relationships are listed; each becomes a
`server/src/models/<Model>.model.ts` in the phase that needs it. `→` = reference.

### Identity, tenancy & security
- **Institution** *[global]* — name, slug, domain(s), branding {logo, colors}, storageQuotaBytes, status, → subscription.
- **Department** — institutionId, name, code, → hodUserId.
- **User** — institutionId, email (unique per domain), passwordHash (Argon2id), status, → roles[], primaryRole, mfaEnabled, lastLoginAt. *No plaintext, ever.*
- **StudentProfile** — → userId, rollNo, → department, batch, year, section, photoRef, contact (privacy-controlled).
- **FacultyProfile** — → userId, → department, designation, subjectsTaught[].
- **AlumniProfile** — → userId, graduationYear, → department, currentOrg, roleTitle, mentorshipOptIn.
- **Company** *[semi-global]* — name, verified, → recruiters[].
- **Recruiter** — → userId, → company, verifiedByInstitution[].
- **Role** — key (STUDENT, FACULTY, …), label, → permissions[], isSystem.
- **Permission** — key (`attendance:read:self`, …), description.
- **Session** — → userId, institutionId, refreshTokenHash, device, ip, userAgent, lastActiveAt, revokedAt, expiresAt (**TTL index**).
- **LoginHistory** — → userId, ip, device, result, reason, at.
- **PasswordReset** — → userId, tokenHash, expiresAt (**TTL**), usedAt, single-use.
- **MFA** — → userId, type (totp/otp/webauthn), secretRef/credentialRef, verifiedAt.
- **AuditLog** — institutionId, → actorUserId, action, resourceType, resourceId, result, ip, deviceContext, reason, at. *Append-only.*
- **StudentID** — → studentProfile, cardNo, validity, photoRef, status. (No sensitive PII in QR.)
- **QRToken** — institutionId, → subject (user/gatepass/event), purpose, tokenHash, singleUse, expiresAt (**TTL**), revokedAt.

### Academics
- **Subject** — institutionId, → department, code, name, credits.
- **Class** — institutionId, → department, batch, section, → subject, → facultyUserId.
- **Timetable** — institutionId, → class, entries[{day, period, → subject, → faculty, room}].
- **Attendance** — institutionId, → class, → subject, → studentUserId, date/period, status(present/absent), → markedByUserId. *One doc per (student, period).*
- **AttendanceCorrection** — → attendance, requestedBy, oldValue, newValue, reason, status, → reviewedBy, decidedAt. *Transactional with AuditLog.*

### Community & communication
- **Announcement** — institutionId, authorUserId, target{scope: college/dept/batch/section/club/hostel/role, refs}, priority, attachments[→File], scheduleAt, expireAt.
- **Club** — institutionId, name, category, description, → admins[], memberCount, interests[].
- **ClubMembership** — institutionId, → club, → userId, role(member/admin), status(requested/approved), decidedBy.
- **Event** — institutionId, → organizer(club/dept), category, schedule, venue, capacity, → files[], status.
- **EventRegistration** — institutionId, → event, → userId, status, checkInAt (via QR), certificateRef.
- **Discussion** — institutionId, authorUserId, category, title, body, tags[], status.
- **Comment** — institutionId, → discussion(or parentComment), authorUserId, body, reactions{}, reportedCount.
- **Notification** — institutionId, → recipientUserId, type, channels[], payload, readAt. (**TTL** on old read notifications.)
- **Chat** — institutionId, type(direct/group/class/club/…), → members via ChatMembership, name, → createdBy.
- **ChatMembership** — institutionId, → chat, → userId, role, lastReadMessageId, muted.
- **ChatMessage** — institutionId, → chat, → senderUserId, body/attachmentRef, replyTo, type, editedAt, deletedAt. (E2EE for protected DMs/groups — established libraries only.)
- **File** — institutionId, ownerUserId, storageKey, originalName, mime, size, checksum, scanStatus(pending/clean/infected), visibility, → linkedResource.

### Campus operations
- **PermissionRequest** — institutionId, → requesterUserId, type(gate/hostel_leave/hostel_outing/industrial_visit/event/academic), payload, workflow[{approverRole/approverUserId, status, decidedAt, note}], status, currentStep. *Single reusable engine.*
- **GatePass** — institutionId, → permissionRequest, → studentUserId, → qrToken(out), returnQrToken, exitAt, entryAt, status.
- **GateEvent** — institutionId, → gatePass, direction(exit/entry), → securityUserId, at.
- **Hostel** — institutionId, name, → warden, blocks[].
- **HostelRoom** — institutionId, → hostel, block, roomNo, capacity, → occupants[].
- **HostelLeave** — institutionId, → permissionRequest, → studentUserId, from, to, reason, status.
- **HostelOuting** — institutionId, → permissionRequest, → studentUserId, out, expectedReturn, actualReturn.
- **MessMenu** — institutionId, → hostel/mess, day, meals[{type, items[]}].
- **MessFeedback** — institutionId, → messMenu/meal, → userId, rating, comment.
- **MedicalAppointment** — institutionId, → studentUserId, → staffUserId, slot, reason(**restricted**), status. *Strict access control; medical data protected.*
- **EmergencyAlert** — institutionId, → issuedBy, target scope, message, at, status.
- **SOSRequest** — institutionId, → studentUserId, at, location?(optional), targets[], status, response, resolvedAt. *Strict access.*
- **Complaint** — institutionId, → reporterUserId, category, description, image→File, location, priority, → assignee, status, resolutionNote, resolvedAt.
- **Feedback** — institutionId, category, priority, body, status, adminResponse. *Anonymous: no reporter reference stored; anonymity protected from ordinary admins.*
- **CampusLocation** — institutionId, name, type, geo{lat,lng}, description. (OpenStreetMap/Leaflet; no key.)
- **LostFoundItem** — institutionId, kind(lost/found), → reporterUserId, description, image→File, location, date, claim{→claimantUserId, status, verifiedBy}.
- **Achievement** — institutionId, → studentUserId, category, title, description, evidence→File, verifiedBy?.

### Career, placement & alumni
- **Job** / **Internship** — institutionId?(or global feed), → company/provider, title, requiredSkills[], degree, gradYear, location, eligibility{}, source, externalId.
- **JobApplication** — institutionId, → job/internship, → studentUserId, status, timeline[].
- **CareerProfile** — → studentUserId, targetRole, preferredLocations[], interests[], github, portfolio, resumeRef, gradYear, visibility(controls recruiter access).
- **Skill** *[global taxonomy]* — name, category.
- **StudentSkill** — → studentUserId, → skill, level, evidence.
- **Project** — → studentUserId, title, description, stack[], links.
- **Certification** — → studentUserId, name, issuer, issuedAt, credentialUrl.
- **CareerGoal** — → studentUserId, targetRole, targetDate.
- **SkillGap** — → studentUserId, targetRole, missingSkills[], computedAt. *Deterministic; AI only explains.*
- **CareerRoadmap** — → studentUserId, targetRole, steps[], source(deterministic/ai-guidance labeled).
- **CompanyEvent** — institutionId, → company, type, schedule, sponsored?.
- **Interview** — institutionId, → jobApplication, round, schedule, → interviewer, outcome.
- **Placement** — institutionId, → studentUserId, → company, role, package?, offerAt. *Package = financial; access-restricted, not exposed broadly.*
- **AlumniMentorship** — institutionId, → mentorAlumniUserId, → menteeStudentUserId, status, topic.

### Platform / SaaS
- **SponsoredEvent** *[global]* — → company, → event, placement, moderationStatus.
- **InstitutionSubscription** — → institution, plan, limits{seats, storage}, status, period.
- **StorageUsage** — → institution, usedBytes, updatedAt.

## Indexing strategy (representative)

- **Every tenant-scoped collection:** compound index **leading with `institutionId`**, then the
  common query key — e.g. `Attendance { institutionId:1, studentUserId:1, subject:1, date:1 }`.
- **Unique:** `User { institutionId:1, email:1 } unique`; `StudentProfile { institutionId:1, rollNo:1 } unique`; `ClubMembership { club:1, userId:1 } unique`; `EventRegistration { event:1, userId:1 } unique`.
- **TTL:** `Session.expiresAt`, `PasswordReset.expiresAt`, `QRToken.expiresAt`, aged read `Notification`s.
- **Text/search:** text indexes on `Announcement`, `Discussion`, `Event`, `Club`, `LostFoundItem` for search (Phase 3 introduces a unified search facade).
- **Aggregation:** attendance rollups, analytics dashboards, and engagement metrics use aggregation pipelines (Phase 3+), always tenant-filtered first.

## Relationship diagram (core identity slice)

```mermaid
erDiagram
    INSTITUTION ||--o{ DEPARTMENT : has
    INSTITUTION ||--o{ USER : has
    USER ||--o| STUDENTPROFILE : "role profile"
    USER ||--o| FACULTYPROFILE : "role profile"
    USER }o--o{ ROLE : "assigned"
    ROLE }o--o{ PERMISSION : "grants"
    USER ||--o{ SESSION : "has"
    USER ||--o{ LOGINHISTORY : "records"
    STUDENTPROFILE ||--o| STUDENTID : "issues"
    STUDENTID ||--o{ QRTOKEN : "verifies via"
    DEPARTMENT ||--o{ CLASS : contains
    CLASS ||--o{ ATTENDANCE : records
```
