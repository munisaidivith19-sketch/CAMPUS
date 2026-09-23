/**
 * The unified search facade.
 *
 * One query, four text-indexed collections, one ranked list. Two properties matter:
 *
 *  - **Tenant-scoped.** Every underlying query goes through a tenant-scoped repository, so a
 *    search can never reach another institution's content.
 *  - **Authorization-filtered.** Announcements are searched through the SAME audience filter the
 *    feed uses, so search cannot become a side channel to content a reader was not addressed in.
 *    Removed discussions are excluded for the same reason.
 *
 * Results are merged and truncated here rather than paged per-collection, which keeps the
 * ranking honest across kinds at the cost of a bounded fan-out per collection.
 */
import type { Principal } from '@campusconnect/security';
import { SearchResultKind, type SearchResultDTO } from '@campusconnect/types';
import { announcementRepository } from '../repositories/announcement.repository.js';
import { discussionRepository } from '../repositories/discussion.repository.js';
import { eventRepository } from '../repositories/event.repository.js';
import { clubRepository } from '../repositories/club.repository.js';
import type { PageRequest } from '../repositories/base.repository.js';
import { buildAudienceContext } from './scope.service.js';

/** Per-collection fan-out before merging. Bounded so one term cannot pull the whole database. */
const PER_KIND_LIMIT = 25;

function snippet(text: string, length = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= length ? flat : `${flat.slice(0, length - 1)}…`;
}

export async function search(
  principal: Principal,
  term: string,
  page: PageRequest,
  kinds?: SearchResultKind[],
): Promise<{ items: SearchResultDTO[]; total: number }> {
  const { institutionId } = principal;
  const wanted = new Set<SearchResultKind>(kinds ?? Object.values(SearchResultKind));

  const audience = wanted.has(SearchResultKind.ANNOUNCEMENT)
    ? await buildAudienceContext(principal)
    : null;

  const [announcements, discussions, events, clubs] = await Promise.all([
    audience
      ? announcementRepository.searchForAudience(institutionId, audience, term, PER_KIND_LIMIT)
      : Promise.resolve([]),
    wanted.has(SearchResultKind.DISCUSSION)
      ? discussionRepository.search(institutionId, term, PER_KIND_LIMIT)
      : Promise.resolve([]),
    wanted.has(SearchResultKind.EVENT)
      ? eventRepository.search(institutionId, term, PER_KIND_LIMIT)
      : Promise.resolve([]),
    wanted.has(SearchResultKind.CLUB)
      ? clubRepository.search(institutionId, term, PER_KIND_LIMIT)
      : Promise.resolve([]),
  ]);

  const results: SearchResultDTO[] = [
    ...announcements.map((row) => ({
      kind: SearchResultKind.ANNOUNCEMENT,
      id: String(row._id),
      title: row.title,
      snippet: snippet(row.body),
      link: `/announcements/${String(row._id)}`,
      occurredAt: row.publishAt.toISOString(),
    })),
    ...discussions.map((row) => ({
      kind: SearchResultKind.DISCUSSION,
      id: String(row._id),
      title: row.title,
      snippet: snippet(row.body),
      link: `/discussions/${String(row._id)}`,
      occurredAt: row.createdAt.toISOString(),
    })),
    ...events.map((row) => ({
      kind: SearchResultKind.EVENT,
      id: String(row._id),
      title: row.title,
      snippet: snippet(row.description),
      link: `/events/${String(row._id)}`,
      occurredAt: row.startsAt.toISOString(),
    })),
    ...clubs.map((row) => ({
      kind: SearchResultKind.CLUB,
      id: String(row._id),
      title: row.name,
      snippet: snippet(row.description),
      link: `/clubs/${String(row._id)}`,
      occurredAt: null,
    })),
  ];

  // Most recent first; entries without a date (clubs) sort last but stay reachable.
  results.sort((a, b) => {
    if (a.occurredAt && b.occurredAt) return b.occurredAt.localeCompare(a.occurredAt);
    if (a.occurredAt) return -1;
    if (b.occurredAt) return 1;
    return a.title.localeCompare(b.title);
  });

  const start = (page.page - 1) * page.limit;
  return { items: results.slice(start, start + page.limit), total: results.length };
}
