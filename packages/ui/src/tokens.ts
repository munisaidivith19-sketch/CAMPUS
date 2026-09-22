/**
 * CampusConnect Design Tokens — the single source of truth for the visual language.
 *
 * Design language: Glassmorphism + Liquid UI — premium modern SaaS, NOT a traditional ERP.
 * These tokens are consumed by the web app's tailwind.config and by the mobile NativeWind
 * bridge, so web and mobile stay visually consistent. Values are plain data (no framework
 * imports) so any consumer can read them.
 *
 * Accessibility note: the palette is chosen so text/background pairs meet WCAG AA. Glass
 * effects are used sparingly and never at the cost of contrast or readability.
 */

export const color = {
  // Brand — indigo/violet gradient family
  brand: {
    50: '#eef2ff',
    100: '#e0e7ff',
    200: '#c7d2fe',
    300: '#a5b4fc',
    400: '#818cf8',
    500: '#6366f1', // primary
    600: '#4f46e5',
    700: '#4338ca',
    800: '#3730a3',
    900: '#312e81',
  },
  accent: {
    // teal/cyan liquid accent
    400: '#22d3ee',
    500: '#06b6d4',
    600: '#0891b2',
  },
  // Semantic
  success: { 500: '#10b981', 600: '#059669' },
  warning: { 500: '#f59e0b', 600: '#d97706' },
  danger: { 500: '#ef4444', 600: '#dc2626' },
  info: { 500: '#3b82f6', 600: '#2563eb' },
  // Neutrals (slate)
  neutral: {
    0: '#ffffff',
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#020617',
  },
} as const;

/** Glass surface recipes: translucent fills + borders tuned for light and dark. */
export const glass = {
  light: {
    surface: 'rgba(255, 255, 255, 0.60)',
    surfaceStrong: 'rgba(255, 255, 255, 0.78)',
    border: 'rgba(255, 255, 255, 0.50)',
  },
  dark: {
    surface: 'rgba(15, 23, 42, 0.55)',
    surfaceStrong: 'rgba(15, 23, 42, 0.72)',
    border: 'rgba(148, 163, 184, 0.18)',
  },
} as const;

export const blur = {
  sm: '6px',
  md: '12px',
  lg: '20px',
  xl: '32px',
} as const;

export const radius = {
  sm: '0.5rem', // 8px
  md: '0.875rem', // 14px
  lg: '1.25rem', // 20px
  xl: '1.75rem', // 28px — curved containers
  '2xl': '2.25rem',
  full: '9999px',
} as const;

export const spacing = {
  0: '0',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
} as const;

export const shadow = {
  // soft, controlled elevation + subtle glow
  sm: '0 1px 2px rgba(2, 6, 23, 0.06)',
  md: '0 8px 24px rgba(2, 6, 23, 0.10)',
  lg: '0 20px 45px rgba(2, 6, 23, 0.14)',
  glow: '0 0 0 1px rgba(99, 102, 241, 0.20), 0 12px 40px rgba(99, 102, 241, 0.25)',
} as const;

export const typography = {
  fontFamily: {
    sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
    mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
  },
  fontSize: {
    xs: ['0.75rem', { lineHeight: '1rem' }],
    sm: ['0.875rem', { lineHeight: '1.25rem' }],
    base: ['1rem', { lineHeight: '1.5rem' }],
    lg: ['1.125rem', { lineHeight: '1.75rem' }],
    xl: ['1.25rem', { lineHeight: '1.75rem' }],
    '2xl': ['1.5rem', { lineHeight: '2rem' }],
    '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
    '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
  },
  fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700' },
} as const;

export const motion = {
  duration: { fast: '150ms', base: '250ms', slow: '400ms' },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    emphasized: 'cubic-bezier(0.3, 0, 0, 1)',
  },
  // Consumers MUST honor prefers-reduced-motion and disable non-essential motion.
  reducedMotionNote: 'Respect prefers-reduced-motion; disable decorative animation.',
} as const;

export const zIndex = {
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  drawer: 1200,
  modal: 1300,
  toast: 1400,
} as const;

export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

export const tokens = {
  color,
  glass,
  blur,
  radius,
  spacing,
  shadow,
  typography,
  motion,
  zIndex,
  breakpoints,
} as const;

export type Tokens = typeof tokens;
