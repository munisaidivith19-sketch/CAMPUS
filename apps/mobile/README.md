# CampusConnect — Mobile

Expo + React Native + TypeScript, NativeWind, Redux Toolkit, React Navigation, Axios,
Socket.IO client, Expo SecureStore / Camera / Location / Notifications.

## Scripts

```bash
npm run start -w apps/mobile     # Expo dev server (use Expo Go on a device)
npm run typecheck -w apps/mobile
```

## Phase 1 status

Skeleton only. `src/app/index.tsx` renders a foundation screen sharing tokens with web.
**No screens, no auth, no features** — forbidden in Phase 1. Scaffolded (empty) folders:
`navigation/`, `screens/`, `components/`, `store/`, `hooks/`, `lib/`, `theme/`.
Architecture: `../../docs/architecture/05-mobile-architecture.md`.

Refresh tokens use Expo SecureStore (Phase 2). Only `EXPO_PUBLIC_*` values reach the bundle.
