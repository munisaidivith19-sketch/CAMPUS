/**
 * The tenant-scoped base repository.
 *
 * This is where multi-tenancy stops being a convention and becomes a mechanism: every method
 * takes `institutionId` as a REQUIRED first argument and injects it into the filter **last**,
 * after any caller-supplied fields, so a caller can never widen or override the tenant scope —
 * not even by passing `{ institutionId: <other tenant> }`. There is deliberately no
 * "find across tenants" method on this class (ADR-0005, docs/architecture/06-multi-tenancy.md).
 *
 * NoSQL-injection defense does NOT live here. Filters reaching this class are built by
 * repository methods from allowlisted fields and legitimately contain query operators
 * (`$gt`, `$ne`, `$each`) and BSON values. Untrusted input is stripped at the edge by
 * `sanitize.middleware.ts` and then shape-checked by Zod, so nothing a client sent can arrive
 * here as an operator in the first place (SECURITY.md §5).
 */
import { Types, type FilterQuery, type HydratedDocument, type Model, type UpdateQuery } from 'mongoose';

export type IdLike = string | Types.ObjectId;

/** Parse an id without throwing a CastError (which would surface as a 500 instead of a 404). */
export function toObjectId(id: IdLike): Types.ObjectId | null {
  if (id instanceof Types.ObjectId) return id;
  if (typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)) return new Types.ObjectId(id);
  return null;
}

/** Same as `toObjectId` but for ids the server itself produced and knows are well-formed. */
export function requireObjectId(id: IdLike): Types.ObjectId {
  const parsed = toObjectId(id);
  if (!parsed) throw new Error('Invalid ObjectId passed to repository');
  return parsed;
}

export interface PageRequest {
  page: number;
  limit: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export type Doc<TAttrs> = HydratedDocument<TAttrs>;

export abstract class TenantRepository<TAttrs> {
  protected constructor(protected readonly model: Model<TAttrs>) {}

  /**
   * Build a tenant-bound filter. `institutionId` is applied after the caller's fields on
   * purpose — object spread order is the enforcement.
   */
  protected scoped(institutionId: IdLike, filter: FilterQuery<TAttrs> = {}): FilterQuery<TAttrs> {
    return { ...filter, institutionId: requireObjectId(institutionId) } as FilterQuery<TAttrs>;
  }

  async findOneScoped(
    institutionId: IdLike,
    filter: FilterQuery<TAttrs>,
    select?: string,
  ): Promise<HydratedDocument<TAttrs> | null> {
    const query = this.model.findOne(this.scoped(institutionId, filter));
    if (select) query.select(select);
    return query.exec();
  }

  async findByIdScoped(
    institutionId: IdLike,
    id: IdLike,
    select?: string,
  ): Promise<HydratedDocument<TAttrs> | null> {
    const objectId = toObjectId(id);
    // An unparseable id is "not found", never an error — ids come from clients.
    if (!objectId) return null;
    return this.findOneScoped(institutionId, { _id: objectId } as FilterQuery<TAttrs>, select);
  }

  async existsScoped(institutionId: IdLike, filter: FilterQuery<TAttrs>): Promise<boolean> {
    const found = await this.model.exists(this.scoped(institutionId, filter)).exec();
    return found !== null;
  }

  async countScoped(institutionId: IdLike, filter: FilterQuery<TAttrs> = {}): Promise<number> {
    return this.model.countDocuments(this.scoped(institutionId, filter)).exec();
  }

  /** Paginated list. `sort` is chosen by the caller from a fixed set, never from raw input. */
  protected async pageScoped(
    institutionId: IdLike,
    filter: FilterQuery<TAttrs>,
    page: PageRequest,
    sort: Record<string, 1 | -1>,
  ): Promise<Page<HydratedDocument<TAttrs>>> {
    const scopedFilter = this.scoped(institutionId, filter);
    const [items, total] = await Promise.all([
      this.model
        .find(scopedFilter)
        .sort(sort)
        .skip((page.page - 1) * page.limit)
        .limit(page.limit)
        .exec(),
      this.model.countDocuments(scopedFilter).exec(),
    ]);
    return { items, total };
  }

  protected async updateOneScoped(
    institutionId: IdLike,
    filter: FilterQuery<TAttrs>,
    update: UpdateQuery<TAttrs>,
  ): Promise<number> {
    const res = await this.model.updateOne(this.scoped(institutionId, filter), update).exec();
    return res.modifiedCount;
  }

  protected async updateManyScoped(
    institutionId: IdLike,
    filter: FilterQuery<TAttrs>,
    update: UpdateQuery<TAttrs>,
  ): Promise<number> {
    const res = await this.model.updateMany(this.scoped(institutionId, filter), update).exec();
    return res.modifiedCount;
  }
}
