import type { ExpoConfig } from 'expo/config';

// Only EXPO_PUBLIC_* env vars reach the app bundle — never server secrets.
const config: ExpoConfig = {
  name: 'CampusConnect',
  slug: 'campusconnect',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'campusconnect',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: { supportsTablet: true, bundleIdentifier: 'in.edu.jnn.campusconnect' },
  android: { package: 'in.edu.jnn.campusconnect' },
  plugins: ['expo-secure-store', 'expo-camera', 'expo-location', 'expo-notifications'],
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1',
    socketUrl: process.env.EXPO_PUBLIC_SOCKET_URL ?? 'http://localhost:4000',
  },
};

export default config;
