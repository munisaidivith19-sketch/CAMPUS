/**
 * The faculty marking flow and the correction review queue.
 *
 * Marking submits the whole roster in one request, which is how attendance is actually taken
 * and makes the roster a single atomic decision rather than a race of per-student writes. The
 * form defaults everyone to PRESENT, because marking exceptions is the common case.
 */
import { useEffect, useState } from 'react';
import { AttendanceStatus, type ClassDTO } from '@campusconnect/types';
import {
  useDecideCorrectionMutation,
  useGetClassRosterQuery,
  useGetClassesQuery,
  useGetCorrectionQueueQuery,
  useMarkAttendanceMutation,
} from '../../store/campusApi.js';
import { Badge, PageHeader, SectionCard } from '../../components/ui/DataDisplay.js';
import { Alert, EmptyState, ErrorState, SkeletonRows, Spinner } from '../../components/ui/Feedback.js';
import { Button } from '../../components/ui/Button.js';

function todayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString();
}

function RosterForm({ klass }: { klass: ClassDTO }): JSX.Element {
  const [date] = useState(todayIso());
  const [period, setPeriod] = useState(1);
  const roster = useGetClassRosterQuery({ classId: klass.id, date, period });
  const [markAttendance, { isLoading: isSaving }] = useMarkAttendanceMutation();

  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Seed the form from what is already recorded, defaulting unmarked students to PRESENT.
  useEffect(() => {
    if (!roster.data) return;
    setStatuses(
      Object.fromEntries(
        roster.data.students.map((s) => [s.userId, s.status ?? AttendanceStatus.PRESENT]),
      ),
    );
    setNotice(null);
  }, [roster.data]);

  const submit = async (): Promise<void> => {
    setError(null);
    setNotice(null);

    try {
      const result = await markAttendance({
        classId: klass.id,
        date,
        period,
        records: Object.entries(statuses).map(([studentUserId, status]) => ({ studentUserId, status })),
      }).unwrap();

      setNotice(
        `Saved ${result.marked} record(s)` +
          (result.changed > 0 ? ` · ${result.changed} changed from a previous mark` : ''),
      );
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Could not save attendance.');
    }
  };

  if (roster.isLoading) return <Spinner label="Loading roster…" />;
  if (roster.isError || !roster.data) {
    return <ErrorState message="Could not load the roster." onRetry={() => void roster.refetch()} />;
  }

  const present = Object.values(statuses).filter((s) => s === AttendanceStatus.PRESENT).length;

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="period" className="text-sm text-neutral-300">
          Period
        </label>
        <select
          id="period"
          value={period}
          onChange={(e) => setPeriod(Number(e.target.value))}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((p) => (
            <option key={p} value={p} className="bg-neutral-900">
              {p}
            </option>
          ))}
        </select>
        <span className="text-sm text-neutral-400">
          {new Date(date).toLocaleDateString()} · {present}/{roster.data.students.length} present
        </span>
      </div>

      {roster.data.students.length === 0 ? (
        <EmptyState title="No students in this section" />
      ) : (
        <ul className="space-y-2">
          {roster.data.students.map((student) => {
            const status = statuses[student.userId] ?? AttendanceStatus.PRESENT;
            return (
              <li
                key={student.userId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-4 py-2.5"
              >
                <span className="text-sm text-neutral-100">
                  <span className="font-mono text-neutral-400">{student.rollNo}</span> {student.fullName}
                </span>

                <div className="flex gap-2" role="group" aria-label={`Attendance for ${student.fullName}`}>
                  {[AttendanceStatus.PRESENT, AttendanceStatus.ABSENT].map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={status === option}
                      onClick={() => setStatuses((prev) => ({ ...prev, [student.userId]: option }))}
                      className={[
                        'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300',
                        status === option
                          ? option === AttendanceStatus.PRESENT
                            ? 'bg-success-500/25 text-success-500'
                            : 'bg-danger-500/25 text-danger-500'
                          : 'bg-white/5 text-neutral-400 hover:bg-white/10',
                      ].join(' ')}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Button busy={isSaving} onClick={() => void submit()}>
        Save attendance
      </Button>
    </div>
  );
}

export function MarkAttendancePage(): JSX.Element {
  const classes = useGetClassesQuery();
  const [selected, setSelected] = useState<ClassDTO | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title="Mark attendance" subtitle="Choose a class, then record the period." />

      <SectionCard title="Your classes">
        {classes.isLoading && <SkeletonRows rows={3} />}
        {classes.isError && <ErrorState message="Could not load your classes." onRetry={() => void classes.refetch()} />}
        {classes.data?.length === 0 && (
          <EmptyState title="No classes assigned" description="An HOD assigns teaching classes." />
        )}

        {classes.data && classes.data.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {classes.data.map((klass) => (
              <button
                key={klass.id}
                type="button"
                onClick={() => setSelected(klass)}
                aria-pressed={selected?.id === klass.id}
                className={[
                  'rounded-lg border px-4 py-2 text-sm transition',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300',
                  selected?.id === klass.id
                    ? 'border-brand-400 bg-brand-500/20 text-white'
                    : 'border-white/15 text-neutral-300 hover:bg-white/10',
                ].join(' ')}
              >
                {klass.subject.code} · {klass.batch} {klass.section}
                <span className="ml-2 text-xs text-neutral-400">{klass.studentCount} students</span>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      {selected && (
        <SectionCard title={`${selected.subject.name} · ${selected.batch} ${selected.section}`}>
          <RosterForm klass={selected} />
        </SectionCard>
      )}
    </div>
  );
}

/** The review queue for attendance correction requests. */
export function CorrectionsPage(): JSX.Element {
  const queue = useGetCorrectionQueueQuery({ status: 'PENDING' });
  const [decide, { isLoading }] = useDecideCorrectionMutation();
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (id: string, decision: 'APPROVED' | 'REJECTED'): Promise<void> => {
    await decide({ id, decision }).unwrap();
    setNotice(`Request ${decision.toLowerCase()}.`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Correction requests"
        subtitle="Students disputing an attendance record. Approving updates the record itself."
      />

      {notice && <Alert tone="success">{notice}</Alert>}

      <SectionCard title="Pending">
        {queue.isLoading && <SkeletonRows rows={3} />}
        {queue.isError && <ErrorState message="Could not load the queue." onRetry={() => void queue.refetch()} />}
        {queue.data?.length === 0 && <EmptyState title="Nothing to review" />}

        {queue.data && queue.data.length > 0 && (
          <ul className="space-y-3">
            {queue.data.map((correction) => (
              <li key={correction.id} className="rounded-lg border border-white/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-neutral-100">
                      {correction.requestedByName} · {correction.subject?.code ?? '—'}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-400">
                      {correction.date ? new Date(correction.date).toLocaleDateString() : '—'} · period{' '}
                      {correction.period} · asking to change{' '}
                      <Badge tone="bad">{correction.oldValue}</Badge> to{' '}
                      <Badge tone="good">{correction.newValue}</Badge>
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button busy={isLoading} onClick={() => void act(correction.id, 'APPROVED')}>
                      Approve
                    </Button>
                    <Button variant="secondary" busy={isLoading} onClick={() => void act(correction.id, 'REJECTED')}>
                      Reject
                    </Button>
                  </div>
                </div>
                <p className="mt-3 rounded bg-white/5 p-3 text-sm text-neutral-300">{correction.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
