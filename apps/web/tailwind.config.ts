/**
 * Tailwind consumes the shared design tokens so web + mobile share one visual language.
 * See packages/ui/src/tokens.ts and docs/product/DESIGN_SYSTEM.md.
 *
 * The tokens are imported from source by path: Tailwind loads this file through its own
 * loader, which resolves `@campusconnect/ui/tokens` to the package's built `dist/` and would
 * make `vite dev` depend on a prior package build.
 */
import type { Config } from 'tailwindcss';
import { tokens } from '../../packages/ui/src/tokens';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: tokens.color.brand,
        accent: tokens.color.accent,
        success: tokens.color.success,
        warning: tokens.color.warning,
        danger: tokens.color.danger,
        info: tokens.color.info,
        neutral: tokens.color.neutral,
      },
      borderRadius: tokens.radius,
      boxShadow: {
        sm: tokens.shadow.sm,
        md: tokens.shadow.md,
        lg: tokens.shadow.lg,
        glow: tokens.shadow.glow,
      },
      backdropBlur: tokens.blur,
      fontFamily: {
        sans: [...tokens.typography.fontFamily.sans],
        mono: [...tokens.typography.fontFamily.mono],
      },
      transitionTimingFunction: {
        standard: tokens.motion.easing.standard,
        emphasized: tokens.motion.easing.emphasized,
      },
      screens: tokens.breakpoints,
    },
  },
  plugins: [],
};

export default config;
