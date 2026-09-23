/**
 * The weekly timetable grid.
 *
 * Students see their section; staff see their own teaching schedule. The server decides which
 * by role, and the page asks for the faculty view explicitly only when the user chooses it.
 */
import { useState } from 'react';
import { ALL_DAYS, Role } from '@campusconnect/types';
import { useGetTimetableQuery } from '../../store/campusApi.js';
import { useAuth } from '../../hooks/useAuth.js';
import { PageHeader, SectionCard } from '../../components/ui/DataDisplay.js';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback.js';

export function TimetablePage(): JSX.Element {
  const { hasRole } = useAuth();
  const isStudent = hasRole(Role.STUDENT);
  const [scope, setScope] = useState<'SECTION' | 'FACULTY'>(isStudent ? 'SECTION' : 'FACULTY');

  const timetable = useGetTimetableQuery({ scope });

  // Bound to a local so the narrowing survives into the table callbacks below.
  const entries = timetable.data?.entries ?? [];
  const periods = [...new Set(entries.map((e) => e.period))].sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        subtitle={timetable.data?.label}
        action={
          !isStudent && (
            <div className="flex gap-2">
              {(['FACULTY', 'SECTION'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={scope === option}
                  onClick={() => setScope(option)}
                  className={[
                    'rounded-lg px-3 py-1.5 text-sm transition',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300',
                    scope === option ? 'bg-brand-500/20 text-white' : 'text-neutral-300 hover:bg-white/10',
                  ].join(' ')}
                >
                  {option === 'FACULTY' ? 'My schedule' : 'Section'}
                </button>
              ))}
            </div>
          )
        }
      />

      <SectionCard title="Weekly grid">
        {timetable.isLoading && <SkeletonRows rows={4} />}
        {timetable.isError && (
          <ErrorState message="Could not load the timetable." onRetry={() => void timetable.refetch()} />
        )}
        {timetable.data && entries.length === 0 && (
          <EmptyState
            title="No timetable published"
            description="It will appear here once your department publishes one."
          />
        )}

        {timetable.data && entries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">Weekly timetable by day and period</caption>
              <thead>
                <tr>
                  <th scope="col" className="p-2 text-left text-xs uppercase tracking-wide text-neutral-400">
                    Day
                  </th>
                  {periods.map((period) => (
                    <th
                      key={period}
                      scope="col"
                      className="p-2 text-left text-xs uppercase tracking-wide text-neutral-400"
                    >
                      P{period}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ALL_DAYS.map((day) => {
                  const dayEntries = entries.filter((entry) => entry.day === day);
                  if (dayEntries.length === 0) return null;

                  return (
                    <tr key={day} className="border-t border-white/10">
                      <th scope="row" className="p-2 text-left font-medium text-neutral-200">
                        {day}
                      </th>
                      {periods.map((period) => {
                        const entry = dayEntries.find((e) => e.period === period);
                        return (
                          <td key={period} className="p-2 align-top">
                            {entry ? (
                              <div className="rounded-lg bg-white/5 p-2">
                                <p className="font-medium text-neutral-100">{entry.subject.code}</p>
                                <p className="text-xs text-neutral-400">{entry.facultyName ?? 'Unassigned'}</p>
                                {entry.room && <p className="text-xs text-neutral-500">{entry.room}</p>}
                              </div>
                            ) : (
                              <span className="text-neutral-600">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
