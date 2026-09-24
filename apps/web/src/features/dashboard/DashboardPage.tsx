/**
 * The role-aware dashboard.
 *
 * Which panels render is decided from the caller's roles — but that is presentation only. Each
 * panel's data comes from an endpoint that independently scopes what it returns, so a user who
 * forced a different panel to render would see an empty or refused response rather than
 * someone else's data.
 *
 * The principal view is deliberately a read-only aggregate foundation; the full analytics
 * dashboards are Phase 5.
 */
import { Link } from 'react-router-dom';
import { Permission, Role } from '@campusconnect/types';
import {
  useGetAnnouncementsQuery,
  useGetAttendanceSummaryQuery,
  useGetClassesQuery,
  useGetCorrectionQueueQuery,
  useGetEventsQuery,
  useGetScopeAttendanceQuery,
  useGetTimetableQuery,
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

/** Today's periods, pulled out of the weekly grid. */
function TodayPanel(): JSX.Element {
  const timetable = useGetTimetableQuery();
  const dayKey = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date().getDay()];
  const today = timetable.data?.entries.filter((entry) => entry.day === dayKey) ?? [];

  return (
    <SectionCard
      title="Today"
      action={
        <Link to="/timetable" className="text-sm text-brand-200 underline underline-offset-4">
          Full timetable
        </Link>
      }
    >
      {timetable.isLoading && <SkeletonRows rows={2} />}
      {timetable.isError && <ErrorState message="Could not load your timetable." />}
      {timetable.data && today.length === 0 && <EmptyState title="No classes scheduled today" />}

      {today.length > 0 && (
        <ul className="space-y-2">
          {today
            .sort((a, b) => a.period - b.period)
            .map((entry) => (
              <li
                key={`${entry.day}-${entry.period}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-4 py-2.5 text-sm"
              >
                <span className="font-medium text-neutral-100">
                  P{entry.period} · {entry.subject.code}
                </span>
                <span className="text-neutral-400">{entry.subject.name}</span>
                <span className="text-neutral-500">{entry.room ?? '—'}</span>
              </li>
            ))}
        </ul>
      )}
    </SectionCard>
  );
}

function StudentAttendancePanel(): JSX.Element {
  const summary = useGetAttendanceSummaryQuery();
  // Bound to a local so the narrowing survives into the map callback below.
  const overview = summary.data;

  return (
    <SectionCard
      title="Attendance"
      action={
        <Link to="/attendance" className="text-sm text-brand-200 underline underline-offset-4">
          Details
        </Link>
      }
    >
      {summary.isLoading && <SkeletonRows rows={2} />}
      {summary.isError && (
        <ErrorState message="Could not load attendance." onRetry={() => void summary.refetch()} />
      )}

      {overview && (
        <div className="space-y-4">
          {overview.warning && (
            <Alert tone="warning">
              Below the {overview.threshold}% requirement — {overview.overall.present} of{' '}
              {overview.overall.total} periods attended.
            </Alert>
          )}

          <AttendanceMeter
            label="Overall"
            percentage={overview.overall.percentage}
            present={overview.overall.present}
            total={overview.overall.total}
            threshold={overview.threshold}
          />

          {overview.bySubject.slice(0, 3).map((subject) => (
            <AttendanceMeter
              key={subject.subject?.id ?? 'x'}
              label={subject.subject?.code ?? '—'}
              percentage={subject.percentage}
              present={subject.present}
              total={subject.total}
              threshold={overview.threshold}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/** The cohort view shared by mentors, HODs and the principal — each sees a different slice. */
function CohortPanel({ title }: { title: string }): JSX.Element {
  const cohort = useGetScopeAttendanceQuery();

  const atRisk = cohort.data?.students.filter((s) => s.belowThreshold) ?? [];
  const totals = (cohort.data?.students ?? []).reduce(
    (acc, s) => ({ present: acc.present + s.present, total: acc.total + s.total }),
    { present: 0, total: 0 },
  );
  // Aggregate from summed counts, never from a mean of the per-student percentages.
  const aggregate =
    totals.total === 0 ? 0 : Math.round((totals.present / totals.total) * 10_000) / 100;

  return (
    <SectionCard title={title}>
      {cohort.isLoading && <SkeletonRows rows={3} />}
      {cohort.isError && (
        <ErrorState message="Could not load the cohort." onRetry={() => void cohort.refetch()} />
      )}
      {cohort.data?.students.length === 0 && (
        <EmptyState
          title="No attendance recorded yet"
          description="Figures appear once periods are marked."
        />
      )}

      {cohort.data && cohort.data.students.length > 0 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Students" value={cohort.data.students.length} />
            <StatCard
              label="Cohort attendance"
              value={`${aggregate}%`}
              hint={`${totals.present}/${totals.total} periods`}
              tone={aggregate < cohort.data.threshold ? 'warn' : 'good'}
            />
            <StatCard
              label={`Below ${cohort.data.threshold}%`}
              value={atRisk.length}
              tone={atRisk.length > 0 ? 'warn' : 'good'}
            />
          </div>

          <ul className="space-y-2">
            {cohort.data.students.slice(0, 8).map((student) => (
              <li
                key={student.userId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-4 py-2.5 text-sm"
              >
                <span className="text-neutral-100">
                  <span className="font-mono text-neutral-400">{student.rollNo ?? '—'}</span>{' '}
                  {student.fullName}
                </span>
                <span className="text-neutral-400">
                  {student.present}/{student.total}
                </span>
                <Badge tone={student.belowThreshold ? 'warn' : 'good'}>{student.percentage}%</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function TeachingPanel(): JSX.Element {
  const classes = useGetClassesQuery();
  const corrections = useGetCorrectionQueueQuery({ status: 'PENDING' });

  return (
    <SectionCard
      title="Your classes"
      action={
        <Link to="/attendance/mark" className="text-sm text-brand-200 underline underline-offset-4">
          Mark attendance
        </Link>
      }
    >
      {classes.isLoading && <SkeletonRows rows={2} />}
      {classes.isError && (
        <ErrorState message="Could not load classes." onRetry={() => void classes.refetch()} />
      )}
      {classes.data?.length === 0 && <EmptyState title="No classes assigned" />}

      {classes.data && classes.data.length > 0 && (
        <ul className="space-y-2">
          {classes.data.map((klass) => (
            <li
              key={klass.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-4 py-2.5 text-sm"
            >
              <span className="font-medium text-neutral-100">{klass.subject.code}</span>
              <span className="text-neutral-400">
                {klass.batch} {klass.section}
              </span>
              <Badge>{klass.studentCount} students</Badge>
            </li>
          ))}
        </ul>
      )}

      {(corrections.data?.length ?? 0) > 0 && (
        <div className="mt-4">
          <Alert tone="info">
            {corrections.data?.length} correction request(s) awaiting review.{' '}
            <Link to="/attendance/corrections" className="underline underline-offset-4">
              Review now
            </Link>
          </Alert>
        </div>
      )}
    </SectionCard>
  );
}

function AnnouncementsPanel(): JSX.Element {
  const announcements = useGetAnnouncementsQuery();

  return (
    <SectionCard
      title="Announcements"
      action={
        <Link to="/announcements" className="text-sm text-brand-200 underline underline-offset-4">
          All
        </Link>
      }
    >
      {announcements.isLoading && <SkeletonRows rows={2} />}
      {announcements.isError && <ErrorState message="Could not load announcements." />}
      {announcements.data?.length === 0 && <EmptyState title="Nothing right now" />}

      {announcements.data && announcements.data.length > 0 && (
        <ul className="space-y-2">
          {announcements.data.slice(0, 4).map((announcement) => (
            <li key={announcement.id} className="rounded-lg border border-white/10 px-4 py-2.5">
              <p className="text-sm font-medium text-neutral-100">
                {announcement.title}
                {!announcement.read && (
                  <span className="ml-2 align-middle">
                    <Badge tone="info">New</Badge>
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-neutral-400">
                {announcement.author.fullName} ·{' '}
                {new Date(announcement.publishAt).toLocaleDateString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function EventsPanel(): JSX.Element {
  const events = useGetEventsQuery({ upcomingOnly: true });

  return (
    <SectionCard
      title="Upcoming events"
      action={
        <Link to="/events" className="text-sm text-brand-200 underline underline-offset-4">
          All
        </Link>
      }
    >
      {events.isLoading && <SkeletonRows rows={2} />}
      {events.data?.length === 0 && <EmptyState title="Nothing scheduled" />}

      {events.data && events.data.length > 0 && (
        <ul className="space-y-2">
          {events.data.slice(0, 4).map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-4 py-2.5 text-sm"
            >
              <span className="font-medium text-neutral-100">{event.title}</span>
              <span className="text-neutral-400">
                {new Date(event.startsAt).toLocaleDateString()}
              </span>
              {event.registration && <Badge tone="good">Registered</Badge>}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function DashboardPage(): JSX.Element {
  const { user, hasRole, can } = useAuth();

  const isStudent = hasRole(Role.STUDENT);
  const teaches = hasRole(Role.FACULTY, Role.CLASS_MENTOR, Role.HOD);
  const isMentor = hasRole(Role.CLASS_MENTOR);
  const isHod = hasRole(Role.HOD);
  const isPrincipal = hasRole(Role.PRINCIPAL);

  const cohortTitle = isPrincipal
    ? 'College attendance'
    : isHod
      ? 'Department attendance'
      : isMentor
        ? 'My section'
        : 'My classes';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.fullName ?? ''}`}
        subtitle={`Signed in as ${user?.primaryRole.replace('_', ' ').toLowerCase() ?? ''}.`}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {isStudent && <StudentAttendancePanel />}
        {isStudent && <TodayPanel />}

        {teaches && <TeachingPanel />}
        {/* Every cohort view uses the same endpoint; the server decides the slice. */}
        {can(Permission.ATTENDANCE_READ_SCOPE) && <CohortPanel title={cohortTitle} />}

        <AnnouncementsPanel />
        <EventsPanel />
      </div>

      {isPrincipal && (
        <Alert tone="info">
          This is the principal dashboard foundation — read-only college aggregates. Full analytics
          arrive in a later phase.
        </Alert>
      )}
    </div>
  );
}
