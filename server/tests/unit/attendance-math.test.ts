/**
 * The attendance aggregation contract.
 *
 * The requirement is specific: `SUM(present) / SUM(total)`, never a mean of per-group
 * percentages. These tests pin that down with cases where the two answers DIFFER, because a
 * test built on equal group sizes would pass under either implementation and prove nothing.
 */
import { describe, expect, it } from 'vitest';
import { ATTENDANCE_WARNING_THRESHOLD } from '@campusconnect/types';
import { rollUp, summarize } from '../../src/services/attendance.service.js';
import type { AttendanceCounts } from '../../src/repositories/attendance.repository.js';

const counts = (present: number, total: number, key = 'k'): AttendanceCounts => ({ key, present, total });

/** The wrong implementation, written out so the tests can assert we do NOT match it. */
function meanOfPercentages(buckets: AttendanceCounts[]): number {
  const percentages = buckets.map((b) => (b.total === 0 ? 0 : (b.present / b.total) * 100));
  return percentages.reduce((a, b) => a + b, 0) / percentages.length;
}

describe('summarize', () => {
  it('derives the percentage from the counts', () => {
    expect(summarize(15, 20).percentage).toBe(75);
    expect(summarize(1, 3).percentage).toBe(33.33);
    expect(summarize(2, 3).percentage).toBe(66.67);
  });

  it('treats "no conducted periods" as no data, not as zero attendance', () => {
    const empty = summarize(0, 0);
    expect(empty.percentage).toBe(0);
    // A student with nothing recorded has not failed to attend anything.
    expect(empty.belowThreshold).toBe(false);
  });

  it('reports full attendance', () => {
    const perfect = summarize(20, 20);
    expect(perfect.percentage).toBe(100);
    expect(perfect.belowThreshold).toBe(false);
  });

  it('reports zero attendance as below threshold', () => {
    const none = summarize(0, 20);
    expect(none.percentage).toBe(0);
    expect(none.belowThreshold).toBe(true);
  });

  it('carries the raw counts through, so callers can re-derive correctly', () => {
    const summary = summarize(7, 9);
    expect(summary.present).toBe(7);
    expect(summary.total).toBe(9);
  });
});

describe('the 75% boundary', () => {
  it('does not flag a student sitting exactly on the threshold', () => {
    const exactly = summarize(75, 100);
    expect(exactly.percentage).toBe(ATTENDANCE_WARNING_THRESHOLD);
    // "Below 75" is strict: 75.0 is not below 75.
    expect(exactly.belowThreshold).toBe(false);
  });

  it('flags a student just under it', () => {
    expect(summarize(74, 100).belowThreshold).toBe(true);
    expect(summarize(749, 1000).belowThreshold).toBe(true);
  });

  it('does not flag a student just over it', () => {
    expect(summarize(751, 1000).belowThreshold).toBe(false);
  });

  it('handles the exact-threshold case at a small denominator too', () => {
    // 3/4 = 75% exactly.
    expect(summarize(3, 4).percentage).toBe(75);
    expect(summarize(3, 4).belowThreshold).toBe(false);
  });
});

describe('rollUp — the never-average-percentages guarantee', () => {
  it('sums counts across subjects rather than averaging their percentages', () => {
    // 1/1 = 100% and 0/20 = 0%. The mean is 50%; the truth is 1/21 ≈ 4.76%.
    const buckets = [counts(1, 1, 'a'), counts(0, 20, 'b')];

    const totals = rollUp(buckets);
    expect(totals).toEqual({ present: 1, total: 21 });

    const summary = summarize(totals.present, totals.total);
    expect(summary.percentage).toBe(4.76);
    expect(summary.percentage).not.toBe(meanOfPercentages(buckets));
    expect(summary.belowThreshold).toBe(true);
  });

  it('gets the opposite skew right too', () => {
    // 20/20 = 100% and 0/1 = 0%. Mean says 50%; the truth is 20/21 ≈ 95.24%.
    const buckets = [counts(20, 20, 'a'), counts(0, 1, 'b')];
    const totals = rollUp(buckets);

    const summary = summarize(totals.present, totals.total);
    expect(summary.percentage).toBe(95.24);
    expect(meanOfPercentages(buckets)).toBe(50);
    // The wrong method would have flagged this student; the right one does not.
    expect(summary.belowThreshold).toBe(false);
  });

  it('flips the warning verdict where averaging would get it wrong', () => {
    // Heavily weighted toward a subject the student is failing to attend.
    const buckets = [counts(10, 10, 'light'), counts(30, 60, 'heavy')];

    const averaged = meanOfPercentages(buckets); // (100 + 50) / 2 = 75 → NOT below
    const totals = rollUp(buckets); // 40/70 ≈ 57.14 → below
    const summary = summarize(totals.present, totals.total);

    expect(averaged).toBe(75);
    expect(summary.percentage).toBe(57.14);
    expect(summary.belowThreshold).toBe(true);
  });

  it('is unaffected by the order of the buckets', () => {
    const a = rollUp([counts(3, 10, 'x'), counts(9, 10, 'y')]);
    const b = rollUp([counts(9, 10, 'y'), counts(3, 10, 'x')]);
    expect(a).toEqual(b);
  });

  it('handles an empty set without dividing by zero', () => {
    const totals = rollUp([]);
    expect(totals).toEqual({ present: 0, total: 0 });
    expect(summarize(totals.present, totals.total).percentage).toBe(0);
  });

  it('ignores subjects with no conducted periods instead of skewing the result', () => {
    // A subject with 0 total contributes nothing either way.
    const withEmpty = rollUp([counts(8, 10, 'a'), counts(0, 0, 'b')]);
    const withoutEmpty = rollUp([counts(8, 10, 'a')]);
    expect(withEmpty).toEqual(withoutEmpty);
    // Whereas averaging would have dragged 80% down to 40%.
    expect(meanOfPercentages([counts(8, 10, 'a'), counts(0, 0, 'b')])).toBe(40);
  });
});
