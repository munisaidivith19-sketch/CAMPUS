/**
 * @campusconnect/ui — design tokens + framework-agnostic UI contracts.
 *
 * Phase 1 ships the tokens (the design-system foundation). Concrete React/RN primitives
 * (Button, Card, Input, Modal, Toast, Skeleton…) are built on top of these tokens in the
 * phase that introduces UI, so web and mobile share one visual language.
 */
export * from './tokens.js';

/** The catalog of primitives the design system will provide (documented now, built later). */
export const DESIGN_SYSTEM_COMPONENTS = [
  'Button',
  'IconButton',
  'Input',
  'Select',
  'Textarea',
  'Checkbox',
  'Radio',
  'Switch',
  'Card',
  'GlassPanel',
  'Table',
  'Badge',
  'Tabs',
  'Modal',
  'Drawer',
  'Dropdown',
  'Toast',
  'Tooltip',
  'Avatar',
  'Skeleton',
  'EmptyState',
  'ErrorState',
  'Spinner',
  'Pagination',
] as const;

export type DesignSystemComponent = (typeof DESIGN_SYSTEM_COMPONENTS)[number];
