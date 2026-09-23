/**
 * Mobile entry point (Phase 2).
 *
 * Boots by attempting to restore a session from the refresh token in SecureStore, then shows
 * either the signed-in summary or the login screen. Navigation, the Redux store and the full
 * screen set arrive with the rest of the mobile app in a later phase.
 */
import { useEffect, useState } from 'react';
import { registerRootComponent } from 'expo';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { UserDTO } from '@campusconnect/types';
import { tokens } from '@campusconnect/ui/tokens';
import { LoginScreen } from '../screens/LoginScreen.js';
import { logout, restoreSession } from '../lib/api.js';

function SignedIn({ user, onSignOut }: { user: UserDTO; onSignOut: () => void }): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.kicker}>SIGNED IN</Text>
      <Text style={styles.title}>{user.fullName}</Text>
      <Text style={styles.body}>{user.email}</Text>
      <Text style={styles.body}>{user.roles.join(', ')}</Text>
      <Pressable style={styles.secondary} onPress={onSignOut} accessibilityRole="button">
        <Text style={styles.secondaryText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function App(): JSX.Element {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    void (async () => {
      setUser(await restoreSession());
      setBooting(false);
    })();
  }, []);

  if (booting) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <ActivityIndicator color={tokens.color.brand[400]} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      {user ? (
        <SignedIn
          user={user}
          onSignOut={() => {
            void (async () => {
              await logout();
              setUser(null);
            })();
          }}
        />
      ) : (
        <LoginScreen onSignedIn={setUser} />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: tokens.color.neutral[950],
  },
  kicker: { color: tokens.color.accent[400], fontSize: 12, letterSpacing: 2, fontWeight: '600' },
  title: { color: tokens.color.neutral[50], fontSize: 28, fontWeight: '700', marginTop: 8 },
  body: { color: tokens.color.neutral[300], fontSize: 15, marginTop: 6, textAlign: 'center' },
  secondary: {
    marginTop: 24,
    borderColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  secondaryText: { color: tokens.color.neutral[100], fontSize: 15, fontWeight: '600' },
});

registerRootComponent(App);

export default App;
