/** The moderation-scope rules, exhaustively, with no database. */
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Permission, Role } from '@campusconnect/types';
import type { Principal } from '@campusconnect/security';
import {
  canSeeReporters,
  canUseModeration,
  reportVisibility,
  type ModeratorReach,
} from '../../src/policies/moderationScope.js';
import type { ReportContext } from '../../src/models/ContentReport.model.js';

const classA = new Types.ObjectId();
const classB = new Types.ObjectId();
const club = new Types.ObjectId();

const ctx = (
  kind: ReportContext['kind'],
  sourceRef: Types.ObjectId | null = null,
): ReportContext => ({
  kind,
  chatId: new Types.ObjectId(),
  sourceRef,
});

const reach = (overrides: Partial<ModeratorReach>): ModeratorReach => ({
  community: false,
  classIds: [],
  clubIds: [],
  institutionWide: false,
  ...overrides,
});

describe('report visibility', () => {
  it('routes community content to moderation:review holders only', () => {
    expect(reportVisibility(reach({ community: true }), ctx('COMMUNITY'))).toEqual({
      visible: true,
      actionable: true,
    });
    expect(
      reportVisibility(reach({ classIds: null, institutionWide: false }), ctx('COMMUNITY')).visible,
    ).toBe(false);
  });

  it('routes a class chat to the moderators of that class', () => {
    const mentor = reach({ classIds: [String(classA)] });
    expect(reportVisibility(mentor, ctx('CLASS', classA))).toEqual({
      visible: true,
      actionable: true,
    });
    expect(reportVisibility(mentor, ctx('CLASS', classB)).visible).toBe(false);
    expect(reportVisibility(reach({ classIds: null }), ctx('CLASS', classB)).actionable).toBe(true);
  });

  it('treats an empty scope as empty, never as everything', () => {
    expect(reportVisibility(reach({ classIds: [] }), ctx('CLASS', classA)).visible).toBe(false);
    expect(reportVisibility(reach({ clubIds: [] }), ctx('CLUB', club)).visible).toBe(false);
  });

  it('routes a club chat to its admins and to institution-wide moderators', () => {
    expect(reportVisibility(reach({ clubIds: [String(club)] }), ctx('CLUB', club)).actionable).toBe(
      true,
    );
    expect(reportVisibility(reach({ institutionWide: true }), ctx('CLUB', club)).actionable).toBe(
      true,
    );
    expect(reportVisibility(reach({ classIds: null }), ctx('CLUB', club)).visible).toBe(false);
  });

  it('never makes a private conversation actionable, and hides it from scoped moderators', () => {
    for (const kind of ['DIRECT', 'GROUP'] as const) {
      expect(
        reportVisibility(
          reach({ institutionWide: true, classIds: null, community: true }),
          ctx(kind),
        ),
      ).toEqual({
        visible: true,
        actionable: false,
      });
      expect(
        reportVisibility(reach({ clubIds: [String(club)], community: true }), ctx(kind)).visible,
      ).toBe(false);
    }
  });

  it('refuses a derived chat with no source', () => {
    expect(
      reportVisibility(reach({ classIds: null, institutionWide: true }), ctx('CLASS', null))
        .visible,
    ).toBe(false);
  });
});

describe('who may use moderation, and who sees reporters', () => {
  const principal = (permissions: Permission[]): Principal => ({
    userId: 'u',
    institutionId: 'i',
    roles: [Role.FACULTY],
    permissions,
  });

  it('requires moderation:review or chat:moderate', () => {
    expect(canUseModeration(principal([Permission.MODERATION_REVIEW]))).toBe(true);
    expect(canUseModeration(principal([Permission.CHAT_MODERATE]))).toBe(true);
    expect(canUseModeration(principal([Permission.REPORT_CREATE]))).toBe(false);
  });

  it('shows reporter identities only with audit:read', () => {
    expect(canSeeReporters(principal([Permission.MODERATION_REVIEW]))).toBe(false);
    expect(canSeeReporters(principal([Permission.MODERATION_REVIEW, Permission.AUDIT_READ]))).toBe(
      true,
    );
  });
});
