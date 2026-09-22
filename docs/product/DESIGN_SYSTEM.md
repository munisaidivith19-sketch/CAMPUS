# Design System

**Design language: Glassmorphism + Liquid UI.** CampusConnect must read as a *premium modern SaaS
platform* — not a traditional ERP, old college portal, Bootstrap dashboard, or generic admin
template. This document is the design foundation; tokens live in `packages/ui/src/tokens.ts` and
are consumed by both web (Tailwind) and mobile (NativeWind).

## Principles

1. **Readability and accessibility first.** Glass and glow are used sparingly; contrast and
   hierarchy always win. Every text/surface pair targets WCAG AA.
2. **One system, every screen.** All screens compose the same tokens and primitives — never
   one-off inline styling.
3. **Motion with restraint.** Fluid transitions and micro-interactions via Framer Motion, always
   honoring `prefers-reduced-motion`. No distracting animation.
4. **Consistency over novelty.** Shared spacing, radius, and elevation scales.

## Token groups (see `packages/ui`)

- **Color** — brand (indigo/violet), teal/cyan accent, semantic (success/warning/danger/info),
  slate neutrals with light+dark values.
- **Glass surfaces** — translucent fills + soft borders tuned per theme (`glass.light` / `glass.dark`).
- **Blur** — backdrop-blur scale (sm→xl).
- **Radius** — large, curved containers (up to `2xl`).
- **Spacing** — 4px-based scale.
- **Shadow** — soft elevation + a controlled brand `glow`.
- **Typography** — Inter (sans) / JetBrains Mono; type scale + weights.
- **Motion** — durations + easing; reduced-motion rule baked in.
- **zIndex / breakpoints** — layering + responsive scale.

## Component catalog (built in later phases)

Buttons, inputs, selects, checkboxes/radios/switches, cards, **GlassPanel**, tables, badges,
tabs, modals, drawers, dropdowns, toasts, tooltips, avatars, skeletons, **empty states**,
**error states**, spinners, pagination. Each primitive must ship with: keyboard operability,
visible focus states, semantic markup/labels, AA contrast, and loading/empty/error variants
where applicable. The catalog is enumerated in `packages/ui/src/index.ts`.

## Usage rules

- Components pull values from tokens; **no hardcoded colors/spacing** in feature code.
- Glass effect = translucent surface + backdrop blur + soft border; never stack so many that
  text legibility drops.
- Data views implement **loading (skeleton) / empty / error** states as first-class UI.
- Light and dark themes are both first-class; tokens carry both.

## Responsive

Desktop, laptop, tablet, and mobile browser for web; Android and iOS for the app. All critical
functionality works at every supported size.
