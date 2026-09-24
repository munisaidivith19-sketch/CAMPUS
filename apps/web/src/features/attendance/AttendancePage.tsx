/**
 * The student's attendance view: overall figure, per-subject breakdown, the record list, and
 * the correction request flow.
 *
 * Counts are shown next to every percentage on purpose — a student disputing a figure needs to
 * see which periods it came from, and the correction flow starts from a specific record.
 */
import { useState, type FormEvent } from 'react';
import { AttendanceStatus, type AttendanceRecordDTO } from '@campusconnect/types';
import {
  useGetAttendanceRecordsQuery,
  useGetAttendanceSummaryQuery,
  useGetMyCorrectionsQuery,
  useRequestCorrectionMutation,
} from '../../store/campusApi.js';
import {
  AttendanceMeter,
  Badge,
  PageHeader,
  SectionCard,
  StatCard,
} from '../../components/ui/DataDisplay.js';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';

function CorrectionDialog({
  record,
  onClose,
}: {
  record: AttendanceRecordDTO;
  onClose: () => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [requestCorrection, { isLoading }] = useRequestCorrectionMutation();

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (reason.trim().length < 10) {
      setError('Explain why the record is wrong (at least 10 characters).');
      return;
    }

    try {
      await requestCorrection({
        attendanceId: record.id,
        // A correction always flips to the other value.
        newValue:
          record.status === AttendanceStatus.ABSENT
            ? AttendanceStatus.PRESENT
            : AttendanceStatus.ABSENT,
        reason: reason.trim(),
      }).unwrap();
      onClose();
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Could not submit your request.');
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mt-4 space-y-4 rounded-lg border border-white/15 p-4"
    >
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-sm text-neutral-300">
        Requesting a change for <strong>{record.subject.code}</strong> on{' '}
        {new Date(record.date).toLocaleDateString()}, period {record.period} — currently{' '}
        <strong>{record.status}</strong>.
      </p>
      <Input
        label="Why is this record wrong?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="Your class teacher will review this."
        required
      />
      <div className="flex gap-2">
        <Button type="submit" busy={isLoading}>
          Submit request
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function AttendancePage(): JSX.Element {
  const summary = useGetAttendanceSummaryQuery();
  const records = useGetAttendanceRecordsQuery({ limit: 50 });
  const corrections = useGetMyCorrectionsQuery();
  const [disputing, setDisputing] = useState<AttendanceRecordDTO | null>(null);

  // Bound to a local so the narrowing survives into the map callbacks below.
  const overview = summary.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Attendance" subtitle="Your record across every subject." />

      {summary.isLoading && <SkeletonRows rows={3} />}
      {summary.isError && (
        <ErrorState
          message="Could not load your attendance."
          onRetry={() => void summary.refetch()}
        />
      )}

      {overview && (
        <>
          {overview.warning && (
            <Alert tone="warning">
              Your overall attendance is {overview.overall.percentage}%, below the{' '}
              {overview.threshold}% requirement ({overview.overall.present} of{' '}
              {overview.overall.total} periods attended).
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Overall"
              value={overview.overall.total === 0 ? '—' : `${overview.overall.percentage}%`}
              hint={`${overview.overall.present} of ${overview.overall.total} periods`}
              tone={overview.warning ? 'warn' : 'good'}
            />
            <StatCard label="Required" value={`${overview.threshold}%`} />
            <StatCard
              label="Subjects below requirement"
              value={overview.bySubject.filter((s) => s.belowThreshold).length}
              tone={overview.bySubject.some((s) => s.belowThreshold) ? 'warn' : 'good'}
            />
          </div>

          <SectionCard title="By subject">
            {overview.bySubject.length === 0 ? (
              <EmptyState title="No attendance recorded yet" />
            ) : (
              <div className="space-y-5">
                {overview.bySubject.map((subject) => (
                  <AttendanceMeter
                    key={subject.subject?.id ?? 'unknown'}
                    label={`${subject.subject?.code ?? '—'} · ${subject.subject?.name ?? ''}`}
                    percentage={subject.percentage}
                    present={subject.present}
                    total={subject.total}
                    threshold={overview.threshold}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}

      <SectionCard title="Recent periods">
        {records.isLoading && <SkeletonRows rows={4} />}
        {records.isError && (
          <ErrorState
            message="Could not load your records."
            onRetry={() => void records.refetch()}
          />
        )}
        {records.data?.length === 0 && <EmptyState title="Nothing recorded yet" />}

        {records.data && records.data.length > 0 && (
          <ul className="space-y-2">
            {records.data.slice(0, 15).map((record) => (
              <li
                key={record.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-4 py-2.5 text-sm"
              >
                <span className="font-medium text-neutral-100">{record.subject.code}</span>
                <span className="text-neutral-400">
                  {new Date(record.date).toLocaleDateString()} · period {record.period}
                </span>
                <Badge tone={record.status === AttendanceStatus.PRESENT ? 'good' : 'bad'}>
                  {record.status}
                </Badge>
                <Button variant="ghost" onClick={() => setDisputing(record)}>
                  Dispute
                </Button>
              </li>
            ))}
          </ul>
        )}

        {disputing && <CorrectionDialog record={disputing} onClose={() => setDisputing(null)} />}
      </SectionCard>

      <SectionCard title="My correction requests">
        {corrections.isLoading && <SkeletonRows rows={2} />}
        {corrections.data?.length === 0 && (
          <EmptyState title="No requests" description="Dispute a record above to raise one." />
        )}
        {corrections.data && corrections.data.length > 0 && (
          <ul className="space-y-2">
            {corrections.data.map((correction) => (
              <li
                key={correction.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-4 py-2.5 text-sm"
              >
                <span className="text-neutral-200">
                  {correction.subject?.code ?? '—'} · {correction.oldValue} → {correction.newValue}
                </span>
                <span className="text-neutral-400">{correction.reason}</span>
                <Badge
                  tone={
                    correction.status === 'APPROVED'
                      ? 'good'
                      : correction.status === 'REJECTED'
                        ? 'bad'
                        : 'info'
                  }
                >
                  {correction.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
