/**
 * The student home screen: attendance, today's timetable and notifications.
 *
 * Deliberately minimal — Phase 3 Part A only needs the read path proven on device against the
 * same API the web app uses. Navigation and the full screen set come later.
 *
 * The attendance figure shows its raw counts next to the percentage, same as on web: a number
 * a student might dispute should be checkable, not just displayed.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {
  AttendanceOverviewDTO,
  NotificationDTO,
  TimetableDTO,
  UserDTO,
} from '@campusconnect/types';
import { tokens } from '@campusconnect/ui/tokens';
import { fetchAttendanceSummary, fetchNotifications, fetchTimetable } from '../lib/api.js';

const DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

export function HomeScreen({ user, onSignOut }: { user: UserDTO; onSignOut: () => void }): JSX.Element {
  const [attendance, setAttendance] = useState<AttendanceOverviewDTO | null>(null);
  const [timetable, setTimetable] = useState<TimetableDTO | null>(null);
  const [notifications, setNotifications] = useState<NotificationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      // Fetched together; a failure in any one is reported rather than silently empty.
      const [summary, grid, inbox] = await Promise.all([
        fetchAttendanceSummary(),
        fetchTimetable(),
        fetchNotifications(),
      ]);
      setAttendance(summary);
      setTimetable(grid);
      setNotifications(inbox);
    } catch {
      setError('Could not load your campus data. Pull to retry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const today = DAY_KEYS[new Date().getDay()];
  const todayEntries = (timetable?.entries ?? [])
    .filter((entry) => entry.day === today)
    .sort((a, b) => a.period - b.period);
  const unread = notifications.filter((n) => !n.read).length;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={tokens.color.brand[400]} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor="#fff" />}
    >
      <Text style={styles.kicker}>CAMPUSCONNECT</Text>
      <Text style={styles.title}>{user.fullName}</Text>
      <Text style={styles.subtle}>{user.primaryRole.replace('_', ' ').toLowerCase()}</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {attendance && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Attendance</Text>

          {attendance.overall.total === 0 ? (
            <Text style={styles.subtle}>No records yet.</Text>
          ) : (
            <>
              <Text style={[styles.big, attendance.warning && styles.warn]}>
                {attendance.overall.percentage}%
              </Text>
              <Text style={styles.subtle}>
                {attendance.overall.present} of {attendance.overall.total} periods · {attendance.threshold}%
                required
              </Text>

              {attendance.warning && (
                <Text style={styles.warnBanner}>
                  Below the {attendance.threshold}% requirement.
                </Text>
              )}

              {attendance.bySubject.map((subject) => (
                <View key={subject.subject?.id ?? 'x'} style={styles.row}>
                  <Text style={styles.rowLabel}>{subject.subject?.code ?? '—'}</Text>
                  <Text style={[styles.rowValue, subject.belowThreshold && styles.warn]}>
                    {subject.percentage}% ({subject.present}/{subject.total})
                  </Text>
                </View>
              ))}
            </>
          )}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Today</Text>
        {todayEntries.length === 0 ? (
          <Text style={styles.subtle}>No classes scheduled today.</Text>
        ) : (
          todayEntries.map((entry) => (
            <View key={`${entry.day}-${entry.period}`} style={styles.row}>
              <Text style={styles.rowLabel}>
                P{entry.period} · {entry.subject.code}
              </Text>
              <Text style={styles.rowValue}>{entry.room ?? '—'}</Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Notifications{unread > 0 ? ` (${unread} unread)` : ''}</Text>
        {notifications.length === 0 ? (
          <Text style={styles.subtle}>Nothing yet.</Text>
        ) : (
          notifications.slice(0, 6).map((notification) => (
            <View key={notification.id} style={styles.row}>
              <Text style={[styles.rowLabel, !notification.read && styles.unread]} numberOfLines={1}>
                {notification.title}
              </Text>
              <Text style={styles.rowValue}>{notification.type}</Text>
            </View>
          ))
        )}
      </View>

      <Pressable style={styles.secondary} onPress={onSignOut} accessibilityRole="button">
        <Text style={styles.secondaryText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.neutral[950] },
  content: { padding: 24, paddingTop: 64, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.color.neutral[950] },
  kicker: { color: tokens.color.accent[400], fontSize: 12, letterSpacing: 2, fontWeight: '600' },
  title: { color: tokens.color.neutral[50], fontSize: 26, fontWeight: '700', marginTop: 4 },
  subtle: { color: tokens.color.neutral[400], fontSize: 13, marginTop: 2 },
  big: { color: tokens.color.neutral[50], fontSize: 32, fontWeight: '700', marginTop: 4 },
  warn: { color: tokens.color.warning[500] },
  warnBanner: {
    color: tokens.color.warning[500],
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    marginTop: 8,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
  },
  cardTitle: { color: tokens.color.neutral[50], fontSize: 16, fontWeight: '600', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopColor: 'rgba(255,255,255,0.08)',
    borderTopWidth: 1,
    gap: 12,
  },
  rowLabel: { color: tokens.color.neutral[200], fontSize: 14, flexShrink: 1 },
  rowValue: { color: tokens.color.neutral[400], fontSize: 13 },
  unread: { fontWeight: '700', color: tokens.color.neutral[50] },
  error: {
    color: tokens.color.danger[500],
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    marginTop: 12,
  },
  secondary: {
    marginTop: 20,
    borderColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryText: { color: tokens.color.neutral[100], fontSize: 15, fontWeight: '600' },
});
