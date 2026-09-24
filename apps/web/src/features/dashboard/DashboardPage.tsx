/**
 * Role dashboards.
 *
 * The landing page opens the dashboard for the caller's primary role; someone holding several
 * roles gets a switcher. Which tabs appear is presentation only — every dashboard's data comes
 * from its own endpoint, which re-checks the role and narrows to the caller's scope, so forcing
 * a tab open gets a refusal or an empty view, never someone else's data.
 *
 * Charts are plain, accessible bars (`AttendanceMeter`, `role="meter"`) with the number and the
 * raw counts always printed beside them: nothing needs a hover to be read, and status is never
 * carried by colour alone. Percentages arrive from the server with their counts (SUM/SUM).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Role, type AttendanceFigure, type DashboardStudentRow } from '@campusconnect/types';
import {
  useGetClubAdminDashboardQuery,
  useGetFacultyDashboardQuery,
  useGetHodDashboardQuery,
  useGetMentorDashboardQuery,
  useGetPrincipalDashboardQuery,
  useGetStudentDashboardQuery,
} from '../../store/campusApi.js';
import { useAuth } from '../../hooks/useAuth.js';
import {
  AttendanceMeter,
  Badge,
  PageHeader,
  SectionCard,
  StatCard,
} from '../../components/ui/DataDisplay.js';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback.js';

type Kind = 'student' | 'faculty' | 'mentor' | 'hod' | 'principal' | 'club-admin';

const LABEL: Record<Kind, string> = {
  student: 'Student',
  faculty: 'Teaching',
  mentor: 'Class mentor',
  hod: 'Head of department',
  principal: 'Principal',
  'club-admin': 'Club admin',
};

/** Which dashboards a set of roles opens, in a stable order. */
function dashboardsFor(roles: readonly Role[]): Kind[] {
  const kinds: Kind[] = [];
  if (roles.includes(Role.STUDENT)) kinds.push('student');
  if (roles.includes(Role.PRINCIPAL) || roles.includes(Role.SYSTEM_ADMIN)) kinds.push('principal');
  if (roles.includes(Role.HOD)) kinds.push('hod');
  if (roles.includes(Role.CLASS_MENTOR)) kinds.push('mentor');
  if (
    roles.some((role) => role === Role.FACULTY || role === Role.CLASS_MENTOR || role === Role.HOD)
  )
    kinds.push('faculty');
  if (roles.includes(Role.CLUB_ADMIN)) kinds.push('club-admin');
  return kinds;
}

const PRIMARY: Partial<Record<Role, Kind>> = {
  [Role.STUDENT]: 'student',
  [Role.FACULTY]: 'faculty',
  [Role.CLASS_MENTOR]: 'mentor',
  [Role.HOD]: 'hod',
  [Role.PRINCIPAL]: 'principal',
  [Role.SYSTEM_ADMIN]: 'principal',
  [Role.CLUB_ADMIN]: 'club-admin',
};

function Meter({
  label,
  value,
  threshold,
}: {
  label: string;
  value: AttendanceFigure;
  threshold: number;
}): JSX.Element {
  return (
    <AttendanceMeter
      label={label}
      percentage={value.percentage}
      present={value.present}
      total={value.total}
      threshold={threshold}
    />
  );
}

function LowAttendanceList({ rows }: { rows: DashboardStudentRow[] }): JSX.Element {
  if (rows.length === 0) return <EmptyState title="No one below the threshold" />;
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li
          key={row.userId}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-4 py-2.5 text-sm"
        >
          <span className="text-neutral-100">
            <span className="font-mono text-neutral-400">{row.rollNo ?? '—'}</span> {row.fullName}
          </span>
          <span className="text-neutral-400">
            {row.attendance.present}/{row.attendance.total}
          </span>
          <Badge tone="warn">{row.attendance.percentage}% · below</Badge>
        </li>
      ))}
    </ul>
  );
}

function Loading(): JSX.Element {
  return <SkeletonRows rows={4} />;
}

// --- Student ------------------------------------------------------------------------

function StudentDashboard(): JSX.Element {
  const query = useGetStudentDashboardQuery();
  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data)
    return (
      <ErrorState message="Could not load your dashboard." onRetry={() => void query.refetch()} />
    );
  const data = query.data;
  const low = data.attendance.bySubject.filter((row) => row.belowThreshold);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard
        title="Attendance"
        action={
          <Link to="/attendance" className="text-sm text-brand-200 underline underline-offset-4">
            Details
          </Link>
        }
      >
        <div className="space-y-4">
          {data.attendance.overall.belowThreshold && (
            <Alert tone="warning">
              Below the {data.attendance.threshold}% requirement overall —{' '}
              {data.attendance.overall.present} of {data.attendance.overall.total} periods attended.
            </Alert>
          )}
          <Meter
            label="Overall"
            value={data.attendance.overall}
            threshold={data.attendance.threshold}
          />
          {data.attendance.bySubject.map((row) => (
            <Meter
              key={row.subject?.code ?? 'none'}
              label={row.subject?.code ?? '—'}
              value={row}
              threshold={data.attendance.threshold}
            />
          ))}
          {data.attendance.bySubject.length === 0 && (
            <EmptyState title="No attendance recorded yet" />
          )}
          {low.length > 0 && (
            <p className="text-xs text-warning-500">
              Below threshold in: {low.map((row) => row.subject?.code).join(', ')}
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Today">
        {data.today.length === 0 ? (
          <EmptyState title="No classes scheduled today" />
        ) : (
          <ul className="space-y-2">
            {data.today.map((slot) => (
              <li
                key={`${slot.classId}-${slot.period}`}
                className="flex flex-wrap justify-between gap-3 rounded-lg border border-white/10 px-4 py-2.5 text-sm"
              >
                <span className="font-medium text-neutral-100">
                  P{slot.period} · {slot.subject.code}
                </span>
                <span className="text-neutral-400">{slot.subject.name}</span>
                <span className="text-neutral-500">{slot.room ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="At a glance">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Unread announcements" value={data.announcements.unread} />
          <StatCard label="Unread notifications" value={data.unreadNotifications} />
          <StatCard label="Unread chat messages" value={data.unreadChats} />
        </div>
      </SectionCard>

      <SectionCard
        title="Announcements"
        action={
          <Link to="/announcements" className="text-sm text-brand-200 underline underline-offset-4">
            All
          </Link>
        }
      >
        {data.announcements.latest.length === 0 ? (
          <EmptyState title="Nothing right now" />
        ) : (
          <ul className="space-y-2">
            {data.announcements.latest.map((row) => (
              <li key={row.id} className="rounded-lg border border-white/10 px-4 py-2.5 text-sm">
                <Link
                  to={`/announcements/${row.id}`}
                  className="font-medium text-neutral-100 underline-offset-4 hover:underline"
                >
                  {row.title}
                </Link>
                {!row.read && (
                  <span className="ml-2">
                    <Badge tone="info">New</Badge>
                  </span>
                )}
                <p className="text-xs text-neutral-400">
                  {new Date(row.publishAt).toLocaleDateString()} · {row.priority.toLowerCase()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Your upcoming events">
        {data.upcomingEvents.length === 0 ? (
          <EmptyState title="No registrations coming up" />
        ) : (
          <ul className="space-y-2">
            {data.upcomingEvents.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap justify-between gap-3 rounded-lg border border-white/10 px-4 py-2.5 text-sm"
              >
                <span className="font-medium text-neutral-100">{event.title}</span>
                <span className="text-neutral-400">
                  {new Date(event.startsAt).toLocaleString()} · {event.venue}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Your clubs">
        {data.clubs.length === 0 ? (
          <EmptyState title="Not in any clubs yet" />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data.clubs.map((club) => (
              <li key={club.id}>
                <Badge>{club.name}</Badge>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

// --- Faculty -----------------------------------------------------------------------

function FacultyDashboard(): JSX.Element {
  const query = useGetFacultyDashboardQuery();
  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data)
    return (
      <ErrorState message="Could not load your dashboard." onRetry={() => void query.refetch()} />
    );
  const data = query.data;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard
        title="Today's classes"
        action={
          <Link
            to="/attendance/mark"
            className="text-sm text-brand-200 underline underline-offset-4"
          >
            Mark attendance
          </Link>
        }
      >
        {data.pendingToMark > 0 && (
          <Alert tone="warning">
            {data.pendingToMark} class(es) today still need attendance marked.
          </Alert>
        )}
        {data.today.length === 0 ? (
          <EmptyState title="No classes scheduled today" />
        ) : (
          <ul className="mt-3 space-y-2">
            {data.today.map((slot) => (
              <li
                key={`${slot.classId}-${slot.period}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-4 py-2.5 text-sm"
              >
                <span className="font-medium text-neutral-100">
                  P{slot.period} · {slot.subject.code}
                </span>
                <span className="text-neutral-400">
                  {slot.batch} {slot.section}
                </span>
                <Badge tone={slot.marked ? 'good' : 'warn'}>
                  {slot.marked ? 'Marked' : 'Not marked'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="At a glance">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Classes taught" value={data.classCount} />
          <StatCard
            label="To mark today"
            value={data.pendingToMark}
            tone={data.pendingToMark > 0 ? 'warn' : 'good'}
          />
          <StatCard
            label="Corrections waiting"
            value={data.corrections.pending}
            tone={data.corrections.pending > 0 ? 'warn' : 'good'}
          />
        </div>
        {data.corrections.latest.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-neutral-300">
            {data.corrections.latest.map((row) => (
              <li key={row.id}>
                {row.studentName} · {row.subjectCode ?? '—'} ·{' '}
                {new Date(row.date).toLocaleDateString()}{' '}
                <Link
                  to="/attendance/corrections"
                  className="text-brand-200 underline underline-offset-4"
                >
                  Review
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={`Below ${data.threshold}% in your classes`}>
        <LowAttendanceList rows={data.lowAttendance} />
      </SectionCard>
    </div>
  );
}

// --- Mentor --------------------------------------------------------------------------

function MentorDashboard(): JSX.Element {
  const query = useGetMentorDashboardQuery();
  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data)
    return (
      <ErrorState message="Could not load your dashboard." onRetry={() => void query.refetch()} />
    );
  const data = query.data;
  if (!data.section) {
    return (
      <EmptyState
        title="No section assigned"
        description="Ask an administrator to assign the section you mentor."
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title={`Section ${data.section.batch} ${data.section.section}`}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Students" value={data.rosterSize} />
            <StatCard
              label="Corrections waiting"
              value={data.pendingCorrections}
              tone={data.pendingCorrections > 0 ? 'warn' : 'good'}
            />
          </div>
          <Meter
            label="Section attendance"
            value={data.sectionAttendance}
            threshold={data.threshold}
          />
        </div>
      </SectionCard>
      <SectionCard title={`Below ${data.threshold}%`}>
        <LowAttendanceList rows={data.lowAttendance} />
      </SectionCard>
      <SectionCard title="Recent section announcements">
        {data.recentAnnouncements.length === 0 ? (
          <EmptyState title="None yet" />
        ) : (
          <ul className="space-y-1 text-sm text-neutral-200">
            {data.recentAnnouncements.map((row) => (
              <li key={row.id}>
                {row.title}{' '}
                <span className="text-xs text-neutral-500">
                  {new Date(row.publishAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

// --- HOD -------------------------------------------------------------------------------

function HodDashboard(): JSX.Element {
  const query = useGetHodDashboardQuery();
  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data)
    return (
      <ErrorState message="Could not load your dashboard." onRetry={() => void query.refetch()} />
    );
  const data = query.data;
  if (!data.department) return <EmptyState title="No department assigned" />;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title={`${data.department.name} (${data.department.code})`}>
        <div className="space-y-4">
          <Meter label="Department attendance" value={data.attendance} threshold={data.threshold} />
          <StatCard
            label="Corrections waiting"
            value={data.pendingCorrections}
            tone={data.pendingCorrections > 0 ? 'warn' : 'good'}
          />
        </div>
      </SectionCard>
      <SectionCard title="By class">
        {data.byClass.length === 0 ? (
          <EmptyState title="No classes yet" />
        ) : (
          <div className="space-y-3">
            {data.byClass.map((row) => (
              <Meter
                key={row.classId}
                label={`${row.subjectCode} · ${row.batch} ${row.section}`}
                value={row}
                threshold={data.threshold}
              />
            ))}
          </div>
        )}
      </SectionCard>
      <SectionCard title="Faculty">
        {data.faculty.length === 0 ? (
          <EmptyState title="No teaching assignments" />
        ) : (
          <ul className="space-y-1 text-sm text-neutral-200">
            {data.faculty.map((row) => (
              <li key={row.userId}>
                {row.fullName} · {row.classCount} class{row.classCount === 1 ? '' : 'es'}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title="Upcoming department events">
        {data.upcomingEvents.length === 0 ? (
          <EmptyState title="Nothing scheduled" />
        ) : (
          <ul className="space-y-1 text-sm text-neutral-200">
            {data.upcomingEvents.map((event) => (
              <li key={event.id}>
                {event.title} · {new Date(event.startsAt).toLocaleDateString()}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

// --- Principal ----------------------------------------------------------------------------

function PrincipalDashboard(): JSX.Element {
  const query = useGetPrincipalDashboardQuery();
  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data)
    return (
      <ErrorState message="Could not load your dashboard." onRetry={() => void query.refetch()} />
    );
  const data = query.data;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title="College attendance">
        <div className="space-y-3">
          <Meter label="All departments" value={data.attendance} threshold={data.threshold} />
          {data.byDepartment.map((row) => (
            <Meter
              key={row.departmentId ?? 'none'}
              label={`${row.code} · ${row.name}`}
              value={row}
              threshold={data.threshold}
            />
          ))}
          {data.byDepartment.length === 0 && <EmptyState title="No attendance recorded yet" />}
        </div>
      </SectionCard>
      <SectionCard title="Campus at a glance">
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard label="Events this month" value={data.eventsThisMonth} />
          <StatCard
            label="Moderation queue"
            value={data.moderationQueue}
            tone={data.moderationQueue > 0 ? 'warn' : 'good'}
          />
          <StatCard label="Active sessions" value={data.security.activeSessions} />
          <StatCard
            label="Failed sign-ins (24 h)"
            value={data.security.failedLoginsLast24h}
            hint={`of ${data.security.loginsLast24h} attempts`}
            tone={data.security.failedLoginsLast24h > 0 ? 'warn' : 'good'}
          />
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Full analytics are Phase 5; this is the foundation view.
        </p>
      </SectionCard>
      <SectionCard title="Club activity this month">
        {data.clubActivity.length === 0 ? (
          <EmptyState title="No clubs yet" />
        ) : (
          <ul className="space-y-1 text-sm text-neutral-200">
            {data.clubActivity.map((club) => (
              <li key={club.clubId}>
                {club.name} · {club.memberCount} members · {club.eventsThisMonth} event(s)
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

// --- Club admin ----------------------------------------------------------------------------

function ClubAdminDashboard(): JSX.Element {
  const query = useGetClubAdminDashboardQuery();
  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data)
    return (
      <ErrorState message="Could not load your dashboard." onRetry={() => void query.refetch()} />
    );
  if (query.data.clubs.length === 0) return <EmptyState title="You do not administer a club yet" />;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {query.data.clubs.map((club) => (
        <SectionCard
          key={club.id}
          title={club.name}
          action={
            <Link
              to={`/clubs/${club.id}`}
              className="text-sm text-brand-200 underline underline-offset-4"
            >
              Manage
            </Link>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Members" value={club.memberCount} />
            <StatCard
              label="Pending requests"
              value={club.pendingRequests}
              tone={club.pendingRequests > 0 ? 'warn' : 'good'}
            />
          </div>
          {club.events.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-400">No recent or upcoming events.</p>
          ) : (
            <ul className="mt-4 space-y-1 text-sm text-neutral-200">
              {club.events.map((event) => (
                <li key={event.id}>
                  {event.title} · {new Date(event.startsAt).toLocaleDateString()} ·{' '}
                  {event.registrations}
                  {event.capacity ? `/${event.capacity}` : ''} registered · {event.checkIns} checked
                  in
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      ))}
    </div>
  );
}

const VIEWS: Record<Kind, () => JSX.Element> = {
  student: StudentDashboard,
  faculty: FacultyDashboard,
  mentor: MentorDashboard,
  hod: HodDashboard,
  principal: PrincipalDashboard,
  'club-admin': ClubAdminDashboard,
};

export function DashboardPage(): JSX.Element {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const available = dashboardsFor(roles);
  const primary = user ? PRIMARY[user.primaryRole] : undefined;
  const [selected, setSelected] = useState<Kind | null>(null);
  const active =
    selected ?? (primary && available.includes(primary) ? primary : available[0]) ?? null;
  const View = active ? VIEWS[active] : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.fullName ?? ''}`}
        subtitle={active ? `${LABEL[active]} dashboard` : 'Your campus at a glance'}
        action={
          available.length > 1 ? (
            <div role="tablist" aria-label="Dashboard" className="flex flex-wrap gap-2">
              {available.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={active === kind}
                  onClick={() => setSelected(kind)}
                  className={[
                    'rounded-lg px-3 py-1.5 text-sm transition',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300',
                    active === kind
                      ? 'bg-brand-500/20 text-white'
                      : 'text-neutral-300 hover:bg-white/10',
                  ].join(' ')}
                >
                  {LABEL[kind]}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />
      {View ? (
        <View />
      ) : (
        <EmptyState
          title="No dashboard for your role yet"
          description="Your role's dashboard arrives in a later phase."
        />
      )}
    </div>
  );
}
