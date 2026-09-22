# Mobile Architecture

## Shape

Expo-managed React Native app in TypeScript. It reuses the backend contracts
(`@campusconnect/types`, `@campusconnect/validation`) and mirrors the web app's state model so
knowledge transfers directly.

```text
src/
├── app/          # entry, providers (store, navigation container, theme)
├── navigation/   # React Navigation: auth stack, role-based tab navigators, guards
├── screens/      # screens grouped by feature (added per phase)
├── components/   # RN UI components (NativeWind, mirror web `ui` where sensible)
├── store/        # Redux Toolkit — shares slice logic with web where possible
├── hooks/        # useAuth, usePermission…
├── lib/          # api (axios), socket client, secure-store wrapper, push registration
└── theme/        # NativeWind token bridge (same tokens as web)
```

## Navigation & guards

React Navigation with an auth stack and role-aware tab/stack navigators. As on web, navigation
guards are **UX only**; the server authorizes every request.

## Secure storage

Refresh tokens and any sensitive local material use **Expo SecureStore** (OS keychain/keystore).
Access tokens stay in memory. Nothing sensitive is written to AsyncStorage or plain files.

## Device capabilities (used by later phases)

- **Expo Camera** → QR scanning for Digital Student ID, event check-in, gate services.
- **Expo Location** → optional SOS location, campus map positioning.
- **Expo Notifications** → mobile push (one channel of the notification engine).

Each capability is permission-gated at the OS level and only requested at the point of use with
a clear rationale, per privacy-by-design.

## Shared code strategy

Types and validation are imported from `packages/*`. Pure Redux slice logic and API endpoint
definitions are shared where platform-agnostic; anything touching the DOM or RN-specific APIs is
kept in the respective app. The mobile app never receives secrets — only `EXPO_PUBLIC_*` values.

## Build/dev (₹0)

Expo Go for on-device dev with no paid Apple/Google accounts required during development.
Native builds (EAS) and store submission are deferred to a later phase and are optional for the
prototype.
