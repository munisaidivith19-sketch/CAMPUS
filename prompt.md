# 🚀 CAMPUSCONNECT — SINGLE MASTER BUILD PROMPT

## ROLE

You are the **Lead Software Architect, Senior Full-Stack Engineer, Cybersecurity Engineer, UI/UX Designer, DevOps Engineer, AI Engineer, Database Architect, Mobile Engineer, QA Engineer, and Technical Project Manager** for this project.

Your responsibility is to design and progressively implement a production-quality platform called:

# CampusConnect — College Community & Digital Campus Platform

This is **NOT a simple college website or traditional ERP**.

Build it as a scalable, secure, modern, multi-tenant digital campus ecosystem connecting:

* Students
* Faculty
* Class Mentors
* HODs
* Principal
* Club Administrators
* Hostel Wardens
* Mess In-Charge
* Security Guards
* Placement Officers
* Medical Staff
* System Administrators
* Company Recruiters
* Alumni

---

# 1. PRIMARY OBJECTIVE

CampusConnect must become a centralized digital campus platform where students can:

* Create and manage their digital student identity
* View academic information
* Track attendance
* View timetable
* Access study materials
* View announcements
* Discover clubs
* Join clubs
* Discover events
* Register for events
* Participate in discussions
* Communicate through secure chat
* Share resources
* Request permissions
* Manage gate passes
* Manage hostel activities
* View mess information
* Submit complaints
* Submit feedback
* Find campus locations
* Report lost/found items
* Record achievements
* Find internships
* Find jobs
* Build career profiles
* Receive career guidance
* Prepare for interviews
* Connect with companies
* Connect with alumni
* Receive emergency assistance

Administrators must be able to manage the digital campus through role-specific dashboards.

---

# 2. ORIGINAL PROBLEM STATEMENT ALIGNMENT

The platform must solve the problem of fragmented college communication caused by:

* Notice boards
* Messaging groups
* Social media
* Emails
* Informal communication
* Separate systems

The platform must centralize:

* Profiles
* Announcements
* Clubs
* Events
* Discussions
* Notifications
* File sharing
* Search
* Student engagement
* Administrative management

Maintain alignment with the supplied CampusConnect problem statement throughout development.

Do not introduce features that contradict the core purpose.

---

# 3. CRITICAL DEVELOPMENT RULE

Build the project in exactly:

# 5 PHASES

## PHASE 1 — FOUNDATION

Architecture, repository, environment, database design, API design, security architecture, UI/UX system, Docker, documentation, configuration.

## PHASE 2 — IDENTITY & SECURITY

Authentication, RBAC, profiles, sessions, MFA, password recovery, Digital Student ID, QR security.

## PHASE 3 — CORE CAMPUS PLATFORM

Academics, attendance, timetable, announcements, clubs, events, discussions, notifications, chat, files.

## PHASE 4 — CAMPUS OPERATIONS & CAREER

Gate pass, campus movement, hostel, mess, medical, complaints, feedback, map, lost/found, achievements, placement, internships, jobs, career intelligence, alumni.

## PHASE 5 — ADVANCED PLATFORM

AI assistant, AI career intelligence, analytics, SaaS multi-tenancy, recruiter ecosystem, sponsored events, advanced security monitoring, AI security controls, data integrity, production hardening and deployment.

---

# 4. ABSOLUTE PHASE CONTROL

When this prompt is first executed:

# START PHASE 1 ONLY.

Do NOT implement Phase 2, 3, 4 or 5.

After completing Phase 1:

1. Explain what was completed.
2. Show the complete folder tree.
3. Show the complete file tree.
4. Show architecture decisions.
5. Show database architecture.
6. Show API architecture.
7. Show security architecture.
8. Show frontend architecture.
9. Show mobile architecture.
10. Show Docker architecture.
11. Show environment configuration.
12. Show API/key requirements.
13. Show exact setup commands.
14. Show testing strategy.
15. Show what is ready for Phase 2.

Then STOP.

Wait for my exact instruction:

# START PHASE 2

Never automatically continue to another phase.

The same rule applies to every subsequent phase.

---

# 5. ARCHITECTURE MUST REMAIN STABLE

Do not rebuild the project from scratch between phases.

Maintain one architectural source of truth:

`docs/architecture/`

If a later requirement conflicts with the existing architecture:

1. Identify the conflict.
2. Explain the technical impact.
3. Propose the smallest safe change.
4. Do NOT silently introduce a breaking architectural change.
5. Continue only after the change is approved if approval is required.

---

# 6. TECHNOLOGY STACK

Use a coherent TypeScript-first architecture.

## WEB FRONTEND

* React
* TypeScript
* Tailwind CSS
* Redux Toolkit
* React Router
* Axios
* React Hook Form
* Framer Motion
* Lucide React

## MOBILE

* React Native
* Expo
* TypeScript
* NativeWind
* Redux Toolkit
* React Navigation
* Axios
* Socket.IO Client
* Expo SecureStore
* Expo Notifications
* Expo Camera
* Expo Location

## BACKEND

* Node.js
* Express.js
* TypeScript
* REST API
* Socket.IO

## DATABASE

# MongoDB ONLY

Use:

* MongoDB
* Mongoose
* MongoDB indexes
* MongoDB aggregation pipelines

MongoDB is the **sole primary application database**.

Do NOT introduce:

* PostgreSQL
* MySQL
* MariaDB
* SQLite
* Another SQL database

unless a future requirement is explicitly approved after architectural review.

Redis is infrastructure only, not the primary database.

---

# 7. OPTIONAL REDIS

Use Redis only where there is a genuine benefit:

* Rate limiting
* Temporary state
* Caching
* Queues
* Background jobs
* Session-related infrastructure where appropriate

Do not add Redis just because it is available.

The local prototype must still remain understandable and maintainable.

---

# 8. SYSTEM ARCHITECTURE

Use this logical flow:

```text
Web / Mobile
      ↓
HTTPS / TLS
      ↓
CDN / WAF / DDoS Protection
      ↓
Reverse Proxy
      ↓
API Layer
      ↓
Authentication
      ↓
Authorization
      ↓
Validation
      ↓
Business Rules
      ↓
Controllers
      ↓
Services
      ↓
Repositories
      ↓
Mongoose
      ↓
MongoDB
```

Supporting systems:

```text
Socket.IO
Redis
Mailpit / Email Provider
File Storage
ClamAV
AI Provider
Job Providers
Monitoring
Audit Logging
```

---

# 9. REPOSITORY ARCHITECTURE

Create a monorepo:

```text
campusconnect/
│
├── apps/
│   ├── web/
│   └── mobile/
│
├── server/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── validators/
│   │   ├── policies/
│   │   ├── utils/
│   │   ├── jobs/
│   │   ├── sockets/
│   │   └── app.ts
│   │
│   └── tests/
│
├── packages/
│   ├── types/
│   ├── validation/
│   ├── ui/
│   ├── config/
│   └── security/
│
├── infrastructure/
│   ├── docker/
│   ├── nginx/
│   └── monitoring/
│
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── security/
│   ├── database/
│   ├── deployment/
│   └── product/
│
├── scripts/
│
├── tests/
│   ├── integration/
│   ├── e2e/
│   └── security/
│
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
└── package.json
```

Expand this into a complete, logical structure during Phase 1.

Do not generate unnecessary files merely to make the tree look large.

---

# 10. DATABASE ARCHITECTURE

Create MongoDB/Mongoose models for:

```text
Institution
Department
User
StudentProfile
FacultyProfile
AlumniProfile
Company
Recruiter
Role
Permission
Session
LoginHistory
PasswordReset
MFA
AuditLog
StudentID
QRToken

Subject
Class
Timetable
Attendance
AttendanceCorrection

Announcement

Club
ClubMembership

Event
EventRegistration

Discussion
Comment

Notification

Chat
ChatMessage
ChatMembership

File

GatePass
GateEvent

Hostel
HostelRoom
HostelLeave
HostelOuting

MessMenu
MessFeedback

MedicalAppointment

EmergencyAlert
SOSRequest

PermissionRequest

Complaint
Feedback

CampusLocation

LostFoundItem

Achievement

Job
Internship
JobApplication

CareerProfile
Skill
StudentSkill
Project
Certification
CareerGoal
SkillGap
CareerRoadmap

CompanyEvent
Interview
Placement

AlumniMentorship

SponsoredEvent

InstitutionSubscription
StorageUsage
```

Design relationships carefully.

Use appropriate:

* References
* Embedded documents
* Compound indexes
* Unique indexes
* TTL indexes where appropriate
* Aggregation pipelines

Document why each major modeling decision was made.

---

# 11. AUTHENTICATION

Implement official college email authentication.

Example:

`student@jnn.edu.in`

The backend must enforce the institution email domain.

Never trust frontend-only validation.

Authentication must support:

* Email/password
* MFA/OTP
* New-device verification
* Session management
* Active sessions
* Session revocation
* Login history
* Suspicious login detection
* Password change
* Forgot password
* Password reset
* Account recovery

---

# 12. USER ROLES

Support:

```text
STUDENT
FACULTY
CLASS_MENTOR
HOD
PRINCIPAL
CLUB_ADMIN
HOSTEL_WARDEN
MESS_INCHARGE
SECURITY_GUARD
PLACEMENT_OFFICER
MEDICAL_STAFF
SYSTEM_ADMIN
COMPANY_RECRUITER
ALUMNI
```

Design the permission system so additional roles can be added later.

Use:

# RBAC + Resource-Level Authorization

Where required, support ABAC-style conditions.

---

# 13. AUTHORIZATION

Never rely on frontend authorization.

Every protected request must validate:

```text
Identity
↓
Role
↓
Permission
↓
Tenant
↓
Resource ownership/access
↓
Business rule
```

Protect against:

* IDOR
* BOLA
* Broken access control
* Privilege escalation
* Cross-tenant access

---

# 14. PASSWORD SECURITY

Use:

# Argon2id

Never store plaintext passwords.

Never log:

* Passwords
* Password reset tokens
* OTPs
* Private keys
* Session secrets

Implement appropriate password strength and reuse controls.

---

# 15. FORGOT PASSWORD

Implement:

```text
Login
↓
Forgot Password
↓
Official College Email
↓
Backend Request
↓
Secure Reset Token / Code
↓
Email
↓
Verify Code
↓
Create New Password
↓
Invalidate Reset Token
↓
Revoke Appropriate Sessions
↓
Success
```

Security:

* Short-lived token
* Single-use
* Rate-limited
* Secure storage
* Never logged
* Generic responses to prevent account enumeration
* Security notification after successful reset

Local development must use:

# Mailpit

---

# 16. MFA

Support:

* OTP
* MFA
* New-device verification

Where practical, support:

# WebAuthn / Passkeys

Design MFA so it can be expanded later.

---

# 17. DIGITAL STUDENT ID

Create a digital campus ID containing:

* Name
* Student ID
* Department
* Batch
* Year
* Section
* Photo
* College email
* Validity
* QR

QR can support:

* Identity verification
* Attendance
* Event check-in
* Gate services
* Campus services

Never place sensitive PII directly inside the QR payload.

Use secure, short-lived or revocable verification tokens where appropriate.

---

# 18. ATTENDANCE

Students:

* Overall attendance
* Subject attendance
* Daily
* Weekly
* Monthly
* Semester
* Present/Absent
* Below 75% warning

Faculty:

* Mark attendance
* View assigned classes
* View students
* Subject attendance

Hierarchy:

```text
Student → Own Data
Faculty → Assigned Classes
Class Mentor → Section
HOD → Department
Principal → College
System Admin → Authorized Campus Scope
```

Formula:

```text
Present Periods / Total Conducted Periods × 100
```

For aggregation:

```text
Total Present / Total Attendance Records
```

Never average attendance percentages from different groups.

Attendance correction:

```text
Student Request
↓
Faculty Review
↓
Approve / Reject
↓
Audit
```

Audit:

* Original value
* New value
* Actor
* Timestamp
* Reason

---

# 19. ACADEMIC SYSTEM

Implement:

* Departments
* Subjects
* Faculty
* Classes
* Sections
* Semesters
* Internal marks
* Assignments
* Study materials
* Exam timetable
* Results
* Academic calendar

---

# 20. SMART TIMETABLE

Connect:

```text
Timetable
↓
Subject
↓
Faculty
↓
Class
↓
Attendance
↓
Resources
```

Provide:

* Student timetable
* Faculty timetable
* Room
* Section
* Subject
* Period
* Day

---

# 21. ANNOUNCEMENTS

Target:

* College
* Department
* Batch
* Section
* Club
* Hostel
* Faculty
* Students

Support:

* Priority
* Attachments
* Scheduling
* Expiration
* Read/unread
* Search
* Audit

---

# 22. CLUB SYSTEM

Implement:

* Club discovery
* Club profile
* Categories
* Description
* Members
* Membership requests
* Approval
* Club announcements
* Club events
* Activities
* Achievements
* Analytics

Add:

# Interest-Based Club Discovery

Recommendations may consider:

* Student interests
* Skills
* Department
* Previous participation
* Career interests

---

# 23. EVENT SYSTEM

Implement:

* Event creation
* Discovery
* Categories
* Date
* Time
* Venue
* Capacity
* Registration
* Reminders
* QR check-in
* Attendance
* Certificates
* Analytics

Add:

# Personalized Event Recommendations

Based on:

* Interests
* Clubs
* Skills
* Department
* Previous participation
* Career interests

---

# 24. DISCUSSION COMMUNITY

Implement:

* Discussion posts
* Questions
* Answers
* Comments
* Reactions
* Categories
* Search
* Reports
* Moderation

Admin moderation:

* Report queue
* Content review
* Removal
* Audit trail

---

# 25. SECURE CHAT

Support:

```text
Student ↔ Student
Student ↔ Faculty
Faculty ↔ Faculty
Class Groups
Batch Groups
Department Groups
Subject Groups
Club Groups
```

Support:

* Text
* Images
* PDF
* PPT
* PPTX
* DOC
* DOCX
* ZIP
* Project files
* Links
* Replies
* Threads
* Search
* Pin
* Read status
* Typing indicator
* Online status

For protected private/group conversations use established E2EE protocols and audited libraries.

# NEVER INVENT CRYPTOGRAPHY.

---

# 26. FILE SHARING

Implement secure upload/download.

Security:

* File size limits
* MIME validation
* Magic-byte/content validation
* Random filenames
* Non-executable storage
* Malware scanning
* ZIP bomb protection
* Archive limits
* Download authorization
* Audit logging
* Signed URLs where appropriate

Use:

* Multer
* ClamAV

---

# 27. NOTIFICATION ENGINE

Centralized notification system.

Notification types:

* Announcements
* Attendance
* Events
* Clubs
* Chat
* Hostel
* Mess
* Placement
* Complaints
* Emergency
* Permissions
* Security
* Academic
* Career

Channels:

* In-app
* Web push
* Mobile push
* Email

---

# 28. DIGITAL PERMISSION ENGINE

Create one reusable permission/workflow engine.

Generic:

```text
Request
↓
Required Approver(s)
↓
Approve / Reject
↓
Notification
↓
Audit
```

Use for:

* Gate pass
* Hostel leave
* Hostel outing
* Industrial visit
* Event permission
* Department activities
* Academic permission

Do not duplicate workflow logic across modules.

---

# 29. GATE PASS

Flow:

```text
Student
↓
Class Mentor
↓
HOD
↓
Principal
↓
Approved
↓
Secure One-Time QR/Code
↓
Security Scan
↓
Exit Timestamp
```

Return:

```text
Student
↓
Return Code
↓
Security Scan
↓
Entry Timestamp
↓
Class Mentor Notification
```

Dashboard:

* Inside
* Outside
* Exits
* Returns
* Weekly statistics
* Monthly statistics
* Semester statistics
* Time outside
* Approval processing time

Security:

* Cryptographically secure random token
* Single-use
* Expiration
* Revocation
* Server verification
* No sensitive PII in QR

---

# 30. HOSTEL

Students:

* Hostel
* Block
* Room
* Roommates
* Announcements
* Leave
* Outing
* Complaints
* Hostel attendance

Warden:

* Room management
* Student management
* Leave approval
* Outing approval
* In/out
* Announcements
* Complaints
* Occupancy
* Emergency management
* Reports

---

# 31. MESS

Students:

* Daily menu
* Meal schedule
* Feedback
* Complaints
* Preferences
* Announcements

Mess In-Charge:

* Menu
* Meal schedule
* Usage
* Complaints
* Announcements
* Special meal requests
* Reports

---

# 32. EMERGENCY SYSTEM

## Emergency Alerts

Authorized administrators can send alerts to:

* Entire campus
* Department
* Batch
* Section
* Hostel
* Faculty
* Students

## Student SOS

SOS can alert authorized:

* Security
* Principal/Admin
* Hostel Warden
* Medical Staff

Store:

* Student
* Timestamp
* Optional location
* Status
* Response
* Resolution

Use strict access controls.

---

# 33. MEDICAL

Students:

* Medical center information
* Appointment requests
* Emergency requests

Medical staff:

* Appointment management
* Emergency management
* Authorized medical information

Medical data must be strictly protected.

---

# 34. COMPLAINT MANAGEMENT

Categories:

* Wi-Fi
* Classroom
* Electrical
* Water
* Hostel
* Mess
* Transport
* Infrastructure
* Lab

Support:

* Report
* Image
* Location
* Priority
* Assignment
* Status
* Resolution
* Confirmation
* Audit trail
* Resolution time

---

# 35. ANONYMOUS FEEDBACK

Categories:

* College
* Infrastructure
* Academic
* Hostel
* Mess
* Event
* General

Support:

* Anonymous submission
* Category
* Priority
* Status
* Admin response
* Resolution

Protect anonymity from ordinary administrators.

---

# 36. CAMPUS MAP

Use:

# OpenStreetMap + Leaflet

Support:

* Departments
* Classrooms
* Labs
* Library
* Hostels
* Mess
* Medical
* Security gates
* Canteen
* Bus stops
* Offices

Include search and directions.

---

# 37. LOST & FOUND

Implement:

* Lost item
* Found item
* Image
* Location
* Date/time
* Description
* Claim
* Ownership verification
* Admin/Security handling

---

# 38. ACHIEVEMENT PORTFOLIO

Students can add:

* Hackathons
* Sports
* Certifications
* Competitions
* Publications
* Projects
* Club achievements
* Academic achievements

Use achievements for:

* Student profile
* Career profile
* Recruiter visibility
* Alumni networking
* Career guidance

---

# 39. CAREER PROFILE

Create a dedicated career profile containing:

* Skills
* Programming languages
* Technologies
* Projects
* Project descriptions
* GitHub
* Portfolio
* Certifications
* Internship experience
* Work experience
* Hackathons
* Achievements
* Resume
* Target role
* Preferred location
* Career interests
* Graduation year

Ask:

# "What role are you targeting?"

Examples:

* Network Engineer
* Software Engineer
* Cybersecurity Analyst
* Cloud Engineer
* Data Analyst
* DevOps Engineer

---

# 40. CAREER INTELLIGENCE

Career flow:

```text
Student Registration
↓
Career Profile
↓
Skills
↓
Projects
↓
Internships
↓
Certifications
↓
Resume
↓
Target Role
↓
Skill Analysis
↓
Job / Internship Search
↓
Eligibility Matching
↓
Skill Gap
↓
Career Roadmap
↓
Projects
↓
Certifications
↓
Interview Preparation
↓
Application Tracking
```

---

# 41. JOB MATCHING

Use deterministic rules for:

* Required skills
* Degree
* Graduation year
* Experience
* Location
* Eligibility
* Other explicit job requirements

AI may provide:

* Explanation
* Skill-gap interpretation
* Learning guidance
* Resume guidance

AI must NOT be the sole authorization/eligibility engine.

---

# 42. INDUSTRY EXPECTATIONS

Create an Industry Expectations Engine.

For each target role show:

* Technical skills
* Tools
* Certifications
* Projects
* Practical experience
* Interview skills
* Communication skills

Clearly distinguish:

# Verified job-market information

from:

# AI-generated guidance

Never present AI-generated assumptions as official requirements.

---

# 43. JOB PROVIDER ARCHITECTURE

Create a provider abstraction.

```text
JobProvider
   ↓
Provider A
Provider B
Provider C
Company Careers
Institution Recruiters
```

Normalize results into a common job schema.

Third-party API keys must stay on the backend.

Never expose them to the frontend.

Do not scrape sites when their terms prohibit scraping.

---

# 44. PLACEMENT OFFICER

Implement:

* Company management
* Job management
* Internship management
* Eligibility
* Applications
* Interviews
* Selections
* Placement analytics
* Recruitment events
* Campus hiring

---

# 45. COMPANY / RECRUITER PORTAL

Recruiters can:

* Create company profile
* Publish jobs
* Publish internships
* Define eligibility
* Search authorized student career profiles
* Host recruitment events
* Manage applications
* Schedule interviews
* Track candidates

Students control profile visibility.

---

# 46. ALUMNI NETWORK

Implement:

* Alumni profiles
* Alumni directory
* Mentorship
* Career guidance
* Networking
* Alumni events
* Industry interaction
* Opportunities
* Success stories

---

# 47. MULTI-TENANCY

CampusConnect must support multiple institutions.

Architecture:

```text
Platform
↓
Institution
↓
Departments
↓
Users
↓
Clubs
↓
Events
↓
Resources
```

Every tenant must be isolated.

Implement:

* Institution onboarding
* Institution configuration
* Branding
* Logo
* Colors
* Department management
* Storage quota
* Subscription plan structure
* Institution admin
* Custom-domain readiness

# CROSS-TENANT DATA ACCESS MUST NEVER BE POSSIBLE.

Every tenant-scoped query must enforce institution context.

---

# 48. SPONSORED EVENTS

Support:

* Featured event placement
* Company-sponsored workshops
* Hackathons
* Competitions
* Career events
* Sponsored activities

All sponsored content requires moderation/approval.

---

# 49. ANALYTICS

## PRINCIPAL

* College attendance
* Department attendance
* Events
* Clubs
* Engagement
* Gate pass
* Participation

## HOD

* Department analytics
* Attendance
* Student engagement
* Faculty activity

## WARDEN

* Occupancy
* Leave
* Outing
* In/out
* Complaints

## MESS

* Meal usage
* Feedback
* Complaints

## PLACEMENT

* Applications
* Interviews
* Offers
* Placement metrics

## CLUB ADMIN

* Members
* Growth
* Events
* Participation
* Engagement

## INSTITUTION

* Campus-wide analytics

All analytics must respect authorization and privacy.

---

# 50. AI CAMPUS ASSISTANT

The AI assistant can answer questions about:

* Classes
* Attendance
* Events
* Gate passes
* Hostel
* Mess
* Campus map
* Pending requests
* Academic resources
* Career

AI must inherit the same authorization as the application.

For example:

If a student cannot access another student's attendance through the normal API, the AI must also be unable to access it.

# AI MUST NEVER BYPASS BACKEND AUTHORIZATION.

---

# 51. AI CAREER ASSISTANT

Allow students to ask:

> How do I become a Network Engineer?

The assistant can use the student's authorized profile to generate:

* Skill gap
* Learning roadmap
* Project recommendations
* Certification recommendations
* Job guidance
* Internship guidance
* Interview preparation
* Resume guidance

---

# 52. AI ARCHITECTURE

Create an abstraction:

```text
AIProvider
```

Possible providers:

* Gemini
* Ollama
* Future providers

Prototype:

# Gemini Flash-class model

Local alternative:

# Ollama + Llama/Qwen-class model

Never hard-code the application around a single AI provider.

---

# 53. AI SECURITY

Protect against:

* Prompt injection
* Sensitive-data leakage
* Unauthorized tool access
* Excessive permissions
* Malicious documents
* Unsafe generated actions

Implement:

* Tool allowlists
* Permission checks
* Input validation
* Output validation
* Audit logs
* Rate limits
* Sensitive-data filtering
* Context isolation

AI must never independently make:

* Authorization decisions
* Attendance calculations
* Security decisions
* Permission approvals
* Eligibility decisions

---

# 54. AI BEHAVIOR MONITORING

Create a future controlled AI-security subsystem.

If suspicious AI behavior is detected:

```text
Suspicious AI behavior
↓
Stop affected action
↓
Block further tool execution
↓
Preserve logs
↓
Create security incident
↓
Alert authorized administrator
↓
Require controlled recovery
```

Do NOT implement an uncontrolled "AI self-destruct".

Use:

* Circuit breakers
* Tool isolation
* Permission revocation
* Service isolation
* Audit trails

---

# 55. DATA INTEGRITY

Optional advanced module:

* Digital certificates
* Record hashes
* Certificate verification
* Blockchain-backed integrity proofs where genuinely useful

Never store sensitive student information directly on a public blockchain.

Do not add blockchain merely for marketing.

---

# 56. SECURITY ARCHITECTURE

Use defense-in-depth:

```text
Internet
↓
HTTPS / TLS
↓
CDN / WAF / DDoS
↓
Reverse Proxy
↓
Rate Limiting
↓
Authentication
↓
MFA
↓
RBAC / ABAC
↓
Input Validation
↓
Business Rules
↓
Database
↓
Audit Logging
↓
Monitoring
↓
Incident Response
```

---

# 57. SECURITY THREATS

Protect against:

* XSS
* NoSQL injection
* SQL injection if an external SQL system is ever introduced
* CSRF
* Brute force
* Credential stuffing
* Session hijacking
* Broken authentication
* Broken authorization
* IDOR/BOLA
* Privilege escalation
* API abuse
* DDoS/resource exhaustion
* Malicious uploads
* ZIP bombs
* SSRF
* Open redirects
* Clickjacking
* Security misconfiguration
* Dependency vulnerabilities
* Secret leakage
* Prompt injection
* AI data leakage
* Cross-tenant access

For MongoDB specifically, implement:

* Strict Zod schemas
* Mongoose schema validation
* Query allowlists
* Safe query construction
* Rejection of unexpected operators/fields
* Proper authorization

---

# 58. WEB SECURITY

Use:

* Helmet.js
* CSP
* HSTS
* X-Content-Type-Options
* Referrer-Policy
* Permissions-Policy
* Frame protection
* Secure cookies where appropriate
* CORS allowlists
* Request validation
* Output encoding
* Safe rendering

Avoid unsafe DOM APIs.

---

# 59. API SECURITY

Every protected API must have appropriate:

* Authentication
* Authorization
* Tenant validation
* Input validation
* Rate limiting
* Request size limits
* Pagination
* Timeouts
* Error handling
* Audit logging

Use:

# Zod

Never trust frontend validation.

Use:

```text
Frontend
↓
API
↓
Auth
↓
Tenant
↓
Permission
↓
Validation
↓
Business Rules
↓
Database
```

---

# 60. FILE SECURITY

Every upload must pass:

```text
Authentication
↓
Authorization
↓
Size Check
↓
MIME Check
↓
Content/Magic Byte Check
↓
Malware Scan
↓
Storage
↓
Audit
```

Protect against:

* Executable uploads
* Malicious documents
* ZIP bombs
* Oversized files
* Path traversal
* Unauthorized downloads

---

# 61. AUDIT LOGGING

Track:

* User
* Tenant
* Action
* Resource
* Timestamp
* IP context
* Device context
* Result
* Reason where appropriate

Never log:

* Passwords
* OTPs
* Private keys
* Session secrets
* E2EE plaintext

---

# 62. DEVICE & SESSION SECURITY

Users must have:

# My Devices

Show:

* Device
* Browser/app
* Approximate location/context where appropriate
* Last active
* Current session

Actions:

* Logout device
* Logout all other devices
* Revoke session

Also support:

* Login history
* New-device alerts
* Suspicious-login alerts
* Password change
* MFA management

---

# 63. DOCKER ARCHITECTURE

Use Docker Compose for local development.

Services may include:

```text
web
backend
mongodb
redis
mailpit
clamav
```

Only include services when needed.

Containers should use:

* Minimal images
* Non-root users
* Health checks
* Resource limits
* Separate networks
* No secrets baked into images

---

# 64. FREE / ₹0 DEVELOPMENT

The entire local prototype must work without paid cloud services.

Use:

* Docker
* Local MongoDB
* Local Redis if needed
* Mailpit
* Local file storage
* Git
* GitHub
* Postman
* VS Code

AI:

* Free-tier provider where available
* Ollama local model

Cloud deployment can be introduced later.

Never make paid infrastructure mandatory for development.

---

# 65. ENVIRONMENT VARIABLES

Create:

`.env.example`

Potential variables:

```text
MONGODB_URI=
REDIS_URL=

JWT_SECRET=
REFRESH_TOKEN_SECRET=

COLLEGE_EMAIL_DOMAIN=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=

AI_PROVIDER=
AI_API_KEY=

JOB_API_KEY=

CLOUD_STORAGE_KEY=
CLOUD_STORAGE_SECRET=

SENTRY_DSN=
```

Only include variables actually required.

Never commit `.env`.

Never place secrets in frontend code.

---

# 66. API KEY DOCUMENTATION

Create:

`docs/API_KEYS.md`

Use:

| Service | Required? | Purpose | Where to obtain | Environment variable | Free/local alternative |
| ------- | --------- | ------- | --------------- | -------------------- | ---------------------- |

Document:

* AI
* Jobs
* Email
* Storage
* Push notifications
* Maps
* Monitoring
* Error tracking

Never invent API keys or pretend a service is configured when it is not.

---

# 67. FRONTEND DESIGN

The interface must look like a:

# Premium Modern SaaS Platform

NOT:

* Traditional ERP
* Old college portal
* Basic Bootstrap dashboard
* Generic admin template

Design language:

# Glassmorphism + Liquid UI

Use:

* Transparent surfaces
* Backdrop blur
* Soft gradients
* Liquid glass
* Curved containers
* Large border radius
* Soft borders
* Subtle shadows
* Controlled glow
* Fluid transitions
* Micro-interactions
* Smooth scrolling
* Animated navigation
* Skeleton loading
* Toast animations
* Modal transitions
* Drawer transitions

Do not overuse glass effects.

Prioritize:

* Readability
* Accessibility
* Performance
* Hierarchy
* Consistency

---

# 68. DESIGN SYSTEM

Create reusable tokens/components for:

* Colors
* Typography
* Spacing
* Radius
* Shadows
* Blur
* Glass surfaces
* Buttons
* Inputs
* Cards
* Tables
* Charts
* Badges
* Tabs
* Navigation
* Modals
* Toasts
* Dropdowns
* Drawers
* Empty states
* Loading states
* Error states

Every screen must use the same design system.

---

# 69. ANIMATION

Use Framer Motion.

Implement:

* Page transitions
* Sidebar transitions
* Card entrance
* Hover effects
* Button interactions
* Modal transitions
* Drawer transitions
* Tab transitions
* Number animations
* Notification animations
* Chart transitions

Respect:

`prefers-reduced-motion`

Do not create distracting animations.

---

# 70. RESPONSIVE DESIGN

Web:

* Desktop
* Laptop
* Tablet
* Mobile browser

Mobile:

* Android
* iOS

Ensure all critical functionality works at all supported sizes.

---

# 71. ROLE DASHBOARDS

## STUDENT

* Attendance
* Timetable
* Announcements
* Events
* Clubs
* Gate pass
* Hostel
* Mess
* Career
* Notifications
* AI assistant

## FACULTY

* Classes
* Attendance
* Students
* Schedule
* Announcements
* Resources
* Academic management

## CLASS MENTOR

* Section students
* Attendance
* Permissions
* Announcements
* Student activity

## HOD

* Department analytics
* Students
* Faculty
* Attendance
* Events
* Academics

## PRINCIPAL

* College overview
* Attendance
* Departments
* Events
* Engagement
* Security
* Analytics

## WARDEN

* Hostel occupancy
* Leave
* Outing
* In/out
* Complaints

## MESS IN-CHARGE

* Menu
* Meal usage
* Feedback
* Complaints

## SECURITY GUARD

* Gate passes
* QR verification
* In/out
* Emergency

## PLACEMENT OFFICER

* Companies
* Jobs
* Internships
* Applications
* Interviews
* Offers
* Analytics

## MEDICAL STAFF

* Appointments
* Emergency requests
* Authorized medical information

## CLUB ADMIN

* Club
* Members
* Events
* Activities
* Analytics

## RECRUITER

* Company
* Jobs
* Internships
* Candidates
* Interviews
* Recruitment events

## ALUMNI

* Profile
* Networking
* Mentorship
* Opportunities

## SYSTEM ADMIN

* Entire authorized platform management

---

# 72. TESTING

Implement:

* Unit tests
* Integration tests
* API tests
* Authorization tests
* Security tests
* E2E tests

Test:

* Authentication
* MFA
* Password reset
* Session revocation
* RBAC
* Tenant isolation
* Attendance
* Gate passes
* File uploads
* Chat permissions
* Career permissions
* Job matching
* Admin operations
* AI authorization

---

# 73. SECURITY TOOLING

Use where appropriate:

* OWASP ZAP
* Semgrep
* Trivy
* Dependabot
* npm audit
* Secret scanning

CI should detect:

* Vulnerable dependencies
* Secrets
* Container vulnerabilities
* Basic security problems

---

# 74. GIT WORKFLOW

Branches:

```text
main
develop
feature/*
fix/*
security/*
```

Commit examples:

```text
feat(auth): add password reset flow
feat(attendance): add correction workflow
fix(gate): validate expired QR token
security(api): enforce tenant authorization
```

Never commit:

* `.env`
* Passwords
* API keys
* Private keys
* Production secrets
* Real student PII
* Sensitive database dumps

---

# 75. SYNTHETIC DATA

Use synthetic data only.

Never use real student information.

Create development seed data for:

* Institutions
* Departments
* Students
* Faculty
* Clubs
* Events
* Announcements
* Companies
* Jobs
* Alumni
* Hostel
* Mess
* Attendance

---

# 76. DOCUMENTATION

Create:

```text
README.md

docs/
├── architecture/
├── api/
├── security/
├── database/
├── deployment/
└── product/
```

Use Mermaid diagrams where useful.

Document:

* Architecture
* Data flow
* Authentication
* Authorization
* Database relationships
* API domains
* Security controls
* Deployment
* Local development
* AI architecture

---

# 77. PHASE 1

When I say:

# START PHASE 1

Perform ONLY Phase 1.

### Step 1

Analyze all requirements.

### Step 2

Freeze architecture.

### Step 3

Create complete monorepo.

### Step 4

Create configuration files.

### Step 5

Create `.env.example`.

### Step 6

Create `docs/API_KEYS.md`.

### Step 7

Create database architecture.

### Step 8

Create API architecture.

### Step 9

Create security architecture.

### Step 10

Create UI/UX design system.

### Step 11

Create Docker architecture.

### Step 12

Create Windows setup instructions.

### Step 13

Explain dependencies.

### Step 14

Identify:

* Required
* Optional
* Free
* Local
* Production-only

### Step 15

Provide exact commands.

### Step 16

Verify architecture consistency.

Then STOP.

---

# 78. PHASE 1 MUST NOT

Do NOT:

* Implement Phase 2
* Implement authentication screens
* Build the entire dashboard
* Build every API
* Create fake integrations
* Put API keys in source
* Use plaintext passwords
* Store PII inside QR codes
* Trust frontend authorization
* Introduce SQL databases
* Add unnecessary technologies
* Invent APIs
* Invent official college requirements
* Use real student data
* Rebuild the architecture unnecessarily

---

# 79. PHASE 2

Only after I say:

# START PHASE 2

Implement:

* Authentication
* Official email restriction
* Registration
* Login
* Forgot password
* Password reset
* MFA
* New-device verification
* Sessions
* Login history
* Security alerts
* RBAC
* Resource authorization
* User profiles
* Student profiles
* Faculty profiles
* Role management
* Digital Student ID
* Secure QR
* Audit logging
* Security dashboard foundation

Run tests before completing the phase.

Then STOP.

---

# 80. PHASE 3

Only after:

# START PHASE 3

Implement:

* Academic management
* Subjects
* Classes
* Timetable
* Attendance
* Attendance correction
* Announcements
* Clubs
* Club membership
* Events
* Event registration
* Discussion forum
* Notifications
* Secure chat
* File sharing
* Search
* Moderation
* Student dashboard
* Faculty dashboard
* Class Mentor dashboard
* HOD dashboard
* Principal dashboard foundation

Run integration and E2E tests.

Then STOP.

---

# 81. PHASE 4

Only after:

# START PHASE 4

Implement:

* Gate pass
* Campus in/out
* Security dashboard
* Hostel
* Hostel leave
* Hostel outing
* Mess
* Medical
* Emergency
* SOS
* Digital permission engine
* Complaints
* Anonymous feedback
* Campus map
* Lost & found
* Student achievements
* Job portal
* Internship portal
* Career profile
* Target role
* Skill analysis
* Skill gap
* Career roadmap
* Job matching
* Internship matching
* Resume guidance
* Project recommendations
* Certification recommendations
* Interview preparation
* Placement management
* Company portal
* Recruiter portal
* Alumni system

Run full integration tests.

Then STOP.

---

# 82. PHASE 5

Only after:

# START PHASE 5

Implement:

* AI Campus Assistant
* AI Career Assistant
* AI provider abstraction
* Industry Expectations Engine
* Advanced analytics
* Institution SaaS
* Multi-tenancy
* Institution branding
* Storage management
* Subscription structure
* Company partnerships
* Sponsored events
* Advanced engagement analytics
* Club analytics
* Alumni-industry interaction
* AI security monitoring
* AI circuit breakers
* Advanced audit monitoring
* Data integrity
* Optional blockchain verification
* Production security hardening
* CI/CD
* Deployment
* Monitoring
* Observability
* Backup/restore strategy
* Disaster recovery planning

Then run the complete test suite.

---

# 83. FINAL SECURITY PRINCIPLES

Always follow:

1. Backend is the source of truth.
2. Frontend is never trusted.
3. Authorization is always server-side.
4. AI cannot bypass authorization.
5. Tenant isolation is mandatory.
6. Least privilege is mandatory.
7. Sensitive data is protected by default.
8. Important administrative actions are auditable.
9. Established cryptography only.
10. Never invent cryptographic algorithms.
11. APIs are versioned.
12. External providers are replaceable.
13. Local development must work without paid services.
14. Do not over-engineer the MVP.
15. Security is continuous, not a one-time feature.
16. Use synthetic data during development.
17. Never silently change architecture.
18. Never claim the system is "100% secure."
19. Prefer secure defaults.
20. Fail closed for authorization.

---

# 84. ENGINEERING QUALITY RULES

Before considering any phase complete:

* Check TypeScript errors.
* Check linting.
* Check formatting.
* Check imports.
* Check environment configuration.
* Check database connectivity.
* Check API contracts.
* Check authorization.
* Check tenant isolation.
* Check validation.
* Check error handling.
* Check loading states.
* Check empty states.
* Check mobile responsiveness.
* Check accessibility.
* Check security controls.
* Check tests.
* Check Docker health.
* Check documentation.

Do not hide errors.

Do not use fake success responses to make features appear complete.

If an integration is unavailable, clearly mark it as:

`NOT CONFIGURED`

and provide the correct configuration requirement.

---

# 85. ERROR HANDLING

Use consistent API responses.

Example:

```json
{
  "success": false,
  "error": {
    "code": "AUTHORIZATION_DENIED",
    "message": "You are not authorized to perform this action."
  },
  "requestId": "..."
}
```

Never expose:

* Stack traces
* Secrets
* Database internals
* Sensitive implementation details

in production responses.

---

# 86. OBSERVABILITY

Design for:

* Structured logs
* Request IDs
* Error tracking
* Metrics
* Health checks
* Audit events
* Security events
* Performance monitoring

Potential tools:

* OpenTelemetry
* Prometheus
* Grafana
* Sentry

Use local/free alternatives wherever possible.

---

# 87. PERFORMANCE

Design for:

* Pagination
* Lazy loading
* Query optimization
* MongoDB indexes
* Aggregation pipelines
* Caching where appropriate
* Connection pooling
* Upload limits
* API timeouts
* WebSocket connection limits
* Background jobs

Do not optimize prematurely.

Measure before introducing complexity.

---

# 88. ACCESSIBILITY

Support:

* Keyboard navigation
* Semantic HTML
* Focus states
* Accessible forms
* Screen-reader-friendly labels
* Appropriate contrast
* Reduced motion
* Clear validation errors

---

# 89. PRIVACY

Use privacy-by-design.

Users should only see information necessary for their role.

Particularly protect:

* Medical data
* Student records
* Attendance
* Private messages
* Career profiles
* Contact information
* SOS information
* Anonymous feedback
* Security logs

---

# 90. IMPORTANT PRODUCT PRINCIPLE

CampusConnect should feel like:

# "The operating system for a modern college campus."

It should combine:

```text
College Community
+
Academics
+
Campus Operations
+
Communication
+
Student Services
+
Career
+
Recruitment
+
Alumni
+
Security
+
AI
```

into one coherent platform.

Do not make the product feel like 30 disconnected mini-projects.

All modules must share:

* Identity
* RBAC
* Notifications
* Search
* Audit
* Files
* Permissions
* Design system
* Tenant architecture
* Analytics
* Security

---

# 91. FINAL EXECUTION INSTRUCTION

You are now responsible for this project as a long-term engineering system.

Do not rush.

Do not skip architecture.

Do not jump between phases.

Do not rebuild working functionality unnecessarily.

Do not replace MongoDB with another primary database.

Do not introduce unnecessary technologies.

Do not expose secrets.

Do not trust frontend authorization.

Do not allow AI to bypass backend authorization.

Do not invent security mechanisms.

Do not invent cryptographic algorithms.

Do not invent APIs.

Do not fabricate official requirements.

Use synthetic data during development.

Maintain backward compatibility wherever practical.

Maintain documentation as the system evolves.

When a requirement is ambiguous, make the safest reasonable engineering assumption, document the assumption, and continue unless the decision would cause a breaking architectural change.

---

# 🚀 START NOW

## START PHASE 1 ONLY.

Your first response must contain:

1. Requirements analysis
2. Architecture decision
3. Complete monorepo structure
4. Complete Phase 1 file structure
5. Technology dependency plan
6. MongoDB architecture
7. API architecture
8. Authentication architecture
9. Authorization architecture
10. Security architecture
11. Frontend architecture
12. Mobile architecture
13. Docker architecture
14. Environment variables
15. API/key requirements
16. Free/local alternatives
17. Windows setup commands
18. Development workflow
19. Testing strategy
20. Phase 2 prerequisites

Then STOP.

Wait for:

# START PHASE 2
