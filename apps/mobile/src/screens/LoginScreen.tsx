/**
 * Mobile sign-in stub (Phase 2 scope: prove the auth pipeline works on device).
 *
 * Full navigation, MFA and device-verification screens follow with the rest of the mobile app;
 * this screen deliberately reports those states rather than pretending to handle them, so the
 * limitation is visible instead of silently failing.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { UserDTO } from '@campusconnect/types';
import { tokens } from '@campusconnect/ui/tokens';
import { fetchMe, login } from '../lib/api.js';

export function LoginScreen({ onSignedIn }: { onSignedIn: (user: UserDTO) => void }): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const result = await login(email.trim(), password);

      if (result.status === 'MFA_REQUIRED') {
        setError('This account needs a two-factor code. Use the web app for now.');
        return;
      }
      if (result.status === 'DEVICE_VERIFICATION_REQUIRED') {
        setError('This device needs email verification. Use the web app for now.');
        return;
      }

      onSignedIn(await fetchMe());
    } catch {
      // Matches the server's generic answer — the app must not be more specific than the API.
      setError('Could not sign you in. Check your details and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.kicker}>CAMPUSCONNECT</Text>
      <Text style={styles.title}>Sign in</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.label}>Institution email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="username"
        keyboardType="email-address"
        placeholder="you@jnn.edu.in"
        placeholderTextColor={tokens.color.neutral[500]}
      />

      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        placeholderTextColor={tokens.color.neutral[500]}
      />

      <Pressable
        style={[styles.button, busy && styles.buttonBusy]}
        onPress={() => void submit()}
        disabled={busy}
        accessibilityRole="button"
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: tokens.color.neutral[950] },
  kicker: { color: tokens.color.accent[400], fontSize: 12, letterSpacing: 2, fontWeight: '600' },
  title: { color: tokens.color.neutral[50], fontSize: 28, fontWeight: '700', marginTop: 8, marginBottom: 24 },
  label: { color: tokens.color.neutral[200], fontSize: 14, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: tokens.color.neutral[50],
  },
  button: {
    marginTop: 24,
    backgroundColor: tokens.color.brand[500],
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonBusy: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  error: {
    color: tokens.color.danger[500],
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    marginBottom: 8,
  },
});
