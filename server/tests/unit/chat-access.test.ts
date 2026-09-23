/**
 * The chat authorization rules, in isolation.
 *
 * These are the rules the REST routes and the socket handlers both run, so this file is where
 * each one is pinned exactly. The integration suites then check that the service actually asks
 * these questions — the two halves together are what make "membership is the grant" true rather
 * than merely intended.
 */
import { describe, expect, it } from 'vitest';
import { ChatMemberRole, ChatType, Permission, Role } from '@campusconnect/types';
import type { Principal } from '@campusconnect/security';
import { chatAccess, type ChatFacts, type MessageFacts } from '../../src/policies/chatAccess.js';

const ALL_CHAT_PERMISSIONS = [
  Permission.CHAT_READ,
  Permission.CHAT_CREATE,
  Permission.CHAT_MESSAGE_SEND,
  Permission.CHAT_MANAGE,
  Permission.CHAT_MODERATE,
];

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'user-1',
    institutionId: 'inst-1',
    roles: [Role.STUDENT],
    permissions: [Permission.CHAT_READ, Permission.CHAT_CREATE, Permission.CHAT_MESSAGE_SEND],
    sessionId: 'session-1',
    ...overrides,
  };
}

const member = { role: ChatMemberRole.MEMBER, muted: false };
const owner = { role: ChatMemberRole.OWNER, muted: false };
const admin = { role: ChatMemberRole.ADMIN, muted: false };

const group: ChatFacts = { id: 'chat-1', type: ChatType.GROUP, sourceRef: null };
const direct: ChatFacts = { id: 'chat-2', type: ChatType.DIRECT, sourceRef: null };
const classChat: ChatFacts = { id: 'chat-3', type: ChatType.CLASS, sourceRef: 'class-1' };
const clubChat: ChatFacts = { id: 'chat-4', type: ChatType.CLUB, sourceRef: 'club-1' };

describe('membership is what grants access', () => {
  it('lets a member read', () => {
    expect(chatAccess.canRead(principal(), member)).toBe(true);
  });

  it('shows nothing to someone with no membership, however privileged', () => {
    // The whole catalog, and still no access: permissions open the door, membership picks the
    // room. This is the rule the 404-instead-of-403 behaviour rests on.
    const sysadmin = principal({ roles: [Role.SYSTEM_ADMIN], permissions: ALL_CHAT_PERMISSIONS });
    expect(chatAccess.canRead(sysadmin, null)).toBe(false);
    expect(chatAccess.canSend(sysadmin, null)).toBe(false);
  });

  it('refuses a member who does not hold chat:read at all', () => {
    expect(chatAccess.canRead(principal({ permissions: [] }), member)).toBe(false);
  });

  it('separates reading from sending', () => {
    const readOnly = principal({ permissions: [Permission.CHAT_READ] });
    expect(chatAccess.canRead(readOnly, member)).toBe(true);
    expect(chatAccess.canSend(readOnly, member)).toBe(false);
  });
});

describe('group administration', () => {
  it('lets an owner or admin manage members', () => {
    expect(chatAccess.canManageMembers(principal({ permissions: ALL_CHAT_PERMISSIONS }), group, owner)).toBe(true);
    expect(chatAccess.canManageMembers(principal({ permissions: ALL_CHAT_PERMISSIONS }), group, admin)).toBe(true);
  });

  it('does not let a plain member manage', () => {
    expect(chatAccess.canManageMembers(principal({ permissions: ALL_CHAT_PERMISSIONS }), group, member)).toBe(false);
  });

  it('refuses membership edits on DIRECT and derived chats', () => {
    const boss = principal({ permissions: ALL_CHAT_PERMISSIONS });
    // A DM's pair is fixed; a class or club roster is derived and would be overwritten anyway —
    // allowing it would be a quiet way to add an outsider to a class conversation.
    expect(chatAccess.canManageMembers(boss, direct, owner)).toBe(false);
    expect(chatAccess.canManageMembers(boss, classChat, owner)).toBe(false);
    expect(chatAccess.canManageMembers(boss, clubChat, owner)).toBe(false);
  });

  it('allows leaving a group only', () => {
    expect(chatAccess.canLeave(group, member)).toBe(true);
    expect(chatAccess.canLeave(direct, member)).toBe(false);
    expect(chatAccess.canLeave(classChat, member)).toBe(false);
  });

  it('checks the size cap before admitting, not after', () => {
    expect(chatAccess.canAdmitMembers(250, 6, 256)).toBe(true);
    expect(chatAccess.canAdmitMembers(250, 7, 256)).toBe(false);
  });
});

describe('editing and deleting', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const WINDOW = 15 * 60_000;

  const own = (overrides: Partial<MessageFacts> = {}): MessageFacts => ({
    senderUserId: 'user-1',
    createdAt: new Date(now.getTime() - 60_000),
    deleted: false,
    ...overrides,
  });

  it('lets the sender edit inside the window', () => {
    expect(chatAccess.canEdit(principal(), own(), now, WINDOW)).toBe(true);
  });

  it('closes the window', () => {
    const old = own({ createdAt: new Date(now.getTime() - WINDOW - 1) });
    expect(chatAccess.canEdit(principal(), old, now, WINDOW)).toBe(false);
  });

  it('never lets anyone edit someone else’s message', () => {
    // Not even a moderator: removing a message and rewriting it are different powers, and only
    // the first one exists in this system.
    const moderator = principal({ permissions: ALL_CHAT_PERMISSIONS });
    expect(chatAccess.canEdit(moderator, own({ senderUserId: 'user-2' }), now, WINDOW)).toBe(false);
  });

  it('refuses to edit a deleted message', () => {
    expect(chatAccess.canEdit(principal(), own({ deleted: true }), now, WINDOW)).toBe(false);
  });

  it('lets the sender delete their own message with no time limit', () => {
    const ancient = own({ createdAt: new Date('2020-01-01T00:00:00Z') });
    expect(chatAccess.canDeleteOwn(principal(), ancient)).toBe(true);
    expect(chatAccess.canDeleteOwn(principal(), own({ senderUserId: 'user-2' }))).toBe(false);
  });
});

describe('moderator reach', () => {
  const moderator = principal({ roles: [Role.CLASS_MENTOR], permissions: ALL_CHAT_PERMISSIONS });

  it('covers a class chat inside the moderator’s scope', () => {
    expect(
      chatAccess.canModerateDelete(moderator, classChat, { classIds: ['class-1'], clubIds: [] }),
    ).toBe(true);
  });

  it('does not cover a class outside it', () => {
    expect(
      chatAccess.canModerateDelete(moderator, classChat, { classIds: ['class-9'], clubIds: [] }),
    ).toBe(false);
  });

  it('treats an empty scope as nothing and a null scope as everything', () => {
    // `[]` and `null` mean opposite things and collapsing them is how a scoped moderator
    // silently becomes a global one.
    expect(chatAccess.canModerateDelete(moderator, classChat, { classIds: [], clubIds: [] })).toBe(false);
    expect(chatAccess.canModerateDelete(moderator, classChat, { classIds: null, clubIds: [] })).toBe(true);
  });

  it('covers only the clubs the moderator administers', () => {
    expect(chatAccess.canModerateDelete(moderator, clubChat, { classIds: [], clubIds: ['club-1'] })).toBe(true);
    expect(chatAccess.canModerateDelete(moderator, clubChat, { classIds: [], clubIds: ['club-2'] })).toBe(false);
  });

  it('gives no one moderation powers over a DM or a private group', () => {
    // There is no scope that contains a private conversation. If there were, holding
    // chat:moderate would quietly reach every group in the institution.
    const reach = { classIds: null, clubIds: ['club-1'] };
    expect(chatAccess.canModerateDelete(moderator, direct, reach)).toBe(false);
    expect(chatAccess.canModerateDelete(moderator, group, reach)).toBe(false);
  });

  it('requires the permission, not just the scope', () => {
    const plain = principal({ permissions: [Permission.CHAT_READ] });
    expect(chatAccess.canModerateDelete(plain, clubChat, { classIds: null, clubIds: ['club-1'] })).toBe(false);
  });
});
