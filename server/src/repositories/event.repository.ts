/** Event and registration data access. */
import { Types, type FilterQuery } from 'mongoose';
import { EventRegistrationStatus, EventStatus } from '@campusconnect/types';
import { EventModel, type EventAttrs, type EventDocument } from '../models/Event.model.js';
import {
  EventRegistrationModel,
  type EventRegistrationAttrs,
  type EventRegistrationDocument,
} from '../models/EventRegistration.model.js';
import type { Timestamps } from '../models/base.js';
import {
  TenantRepository,
  requireObjectId,
  toObjectId,
  type IdLike,
  type Page,
  type PageRequest,
} from './base.repository.js';

type EventEntity = EventAttrs & Timestamps;
type RegistrationEntity = EventRegistrationAttrs & Timestamps;

class EventRepository extends TenantRepository<EventEntity> {
  constructor() {
    super(EventModel);
  }

  async findById(institutionId: IdLike, id: IdLike): Promise<EventDocument | null> {
    return this.findByIdScoped(institutionId, id);
  }

  async findManyByIds(institutionId: IdLike, ids: IdLike[]): Promise<EventDocument[]> {
    const objectIds = ids.map((id) => toObjectId(id)).filter((id): id is Types.ObjectId => id !== null);
    if (objectIds.length === 0) return [];
    return EventModel.find(this.scoped(institutionId, { _id: { $in: objectIds } })).exec();
  }

  async list(
    institutionId: IdLike,
    page: PageRequest,
    filters: {
      category?: string;
      status?: EventStatus;
      search?: string;
      upcomingOnly?: boolean;
      categories?: string[];
      clubIds?: string[];
    } = {},
  ): Promise<Page<EventDocument>> {
    const filter: FilterQuery<EventEntity> = {};

    if (filters.status) filter.status = filters.status;
    if (filters.category) filter.category = filters.category;
    if (filters.search) filter.$text = { $search: filters.search };
    if (filters.upcomingOnly) filter.endsAt = { $gte: new Date() };

    // Rule-based suggestion inputs: the student's interests and the clubs they belong to.
    const orBranches: FilterQuery<EventEntity>[] = [];
    if (filters.categories && filters.categories.length > 0) {
      orBranches.push({ category: { $in: filters.categories } });
    }
    if (filters.clubIds && filters.clubIds.length > 0) {
      const ids = filters.clubIds
        .map((id) => toObjectId(id))
        .filter((id): id is Types.ObjectId => id !== null);
      if (ids.length > 0) orBranches.push({ clubId: { $in: ids } });
    }
    if (orBranches.length > 0) filter.$or = orBranches;

    return this.pageScoped(institutionId, filter, page, { startsAt: 1 });
  }

  async create(data: {
    institutionId: IdLike;
    title: string;
    description: string;
    category: string;
    venue: string;
    startsAt: Date;
    endsAt: Date;
    capacity?: number | null;
    organizerType: 'CLUB' | 'DEPARTMENT';
    clubId?: IdLike | null;
    departmentId?: IdLike | null;
    createdByUserId: IdLike;
  }): Promise<EventDocument> {
    return EventModel.create({
      institutionId: requireObjectId(data.institutionId),
      title: data.title,
      description: data.description,
      category: data.category,
      venue: data.venue,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      capacity: data.capacity ?? null,
      registeredCount: 0,
      status: EventStatus.PUBLISHED,
      organizerType: data.organizerType,
      clubId: data.clubId ? requireObjectId(data.clubId) : null,
      departmentId: data.departmentId ? requireObjectId(data.departmentId) : null,
      createdByUserId: requireObjectId(data.createdByUserId),
    });
  }

  /**
   * Atomically take a seat.
   *
   * The capacity check lives inside the update filter (`$expr` comparing the counter against
   * capacity), so two simultaneous registrations cannot both claim the last seat — the second
   * one matches nothing and gets null back. A check-then-write in the service would race.
   */
  async reserveSeat(institutionId: IdLike, eventId: IdLike): Promise<EventDocument | null> {
    return EventModel.findOneAndUpdate(
      {
        _id: requireObjectId(eventId),
        institutionId: requireObjectId(institutionId),
        status: EventStatus.PUBLISHED,
        $or: [
          { capacity: null },
          { $expr: { $lt: ['$registeredCount', '$capacity'] } },
        ],
      },
      { $inc: { registeredCount: 1 } },
      { new: true },
    ).exec();
  }

  async releaseSeat(institutionId: IdLike, eventId: IdLike): Promise<void> {
    await EventModel.updateOne(
      {
        _id: requireObjectId(eventId),
        institutionId: requireObjectId(institutionId),
        registeredCount: { $gt: 0 },
      },
      { $inc: { registeredCount: -1 } },
    ).exec();
  }

  async search(institutionId: IdLike, term: string, limit: number): Promise<EventDocument[]> {
    return EventModel.find(this.scoped(institutionId, { $text: { $search: term } }))
      .limit(limit)
      .exec();
  }
}

class EventRegistrationRepository extends TenantRepository<RegistrationEntity> {
  constructor() {
    super(EventRegistrationModel);
  }

  async findForUserAndEvent(
    institutionId: IdLike,
    eventId: IdLike,
    userId: IdLike,
  ): Promise<EventRegistrationDocument | null> {
    const event = toObjectId(eventId);
    const user = toObjectId(userId);
    if (!event || !user) return null;
    return this.findOneScoped(institutionId, { eventId: event, userId: user });
  }

  async listForUser(
    institutionId: IdLike,
    userId: IdLike,
    page: PageRequest,
  ): Promise<Page<EventRegistrationDocument>> {
    return this.pageScoped(institutionId, { userId: requireObjectId(userId) }, page, {
      createdAt: -1,
    });
  }

  async listForUserEvents(institutionId: IdLike, userId: IdLike, eventIds: IdLike[]): Promise<EventRegistrationDocument[]> {
    const ids = eventIds.map((id) => toObjectId(id)).filter((id): id is Types.ObjectId => id !== null);
    const user = toObjectId(userId);
    if (!user || ids.length === 0) return [];
    return EventRegistrationModel.find(
      this.scoped(institutionId, { userId: user, eventId: { $in: ids } }),
    ).exec();
  }

  async create(data: {
    institutionId: IdLike;
    eventId: IdLike;
    userId: IdLike;
  }): Promise<EventRegistrationDocument> {
    return EventRegistrationModel.create({
      institutionId: requireObjectId(data.institutionId),
      eventId: requireObjectId(data.eventId),
      userId: requireObjectId(data.userId),
      status: EventRegistrationStatus.REGISTERED,
    });
  }

  /** Atomic check-in: only a REGISTERED row flips, so a second scan finds nothing to update. */
  async checkIn(
    institutionId: IdLike,
    eventId: IdLike,
    userId: IdLike,
    checkedInByUserId: IdLike,
  ): Promise<EventRegistrationDocument | null> {
    return EventRegistrationModel.findOneAndUpdate(
      {
        institutionId: requireObjectId(institutionId),
        eventId: requireObjectId(eventId),
        userId: requireObjectId(userId),
        status: EventRegistrationStatus.REGISTERED,
      },
      {
        $set: {
          status: EventRegistrationStatus.CHECKED_IN,
          checkInAt: new Date(),
          checkedInByUserId: requireObjectId(checkedInByUserId),
        },
      },
      { new: true },
    ).exec();
  }

  async countForEvent(institutionId: IdLike, eventId: IdLike): Promise<number> {
    return this.countScoped(institutionId, {
      eventId: requireObjectId(eventId),
      status: { $ne: EventRegistrationStatus.CANCELLED },
    });
  }
}

export const eventRepository = new EventRepository();
export const eventRegistrationRepository = new EventRegistrationRepository();
