/**
 * Shared model primitives.
 *
 * Every tenant-scoped collection carries `institutionId` and leads its compound indexes with it
 * (ADR-0005 / docs/architecture/06-multi-tenancy.md). Only collections explicitly marked
 * [global] in docs/database/DATABASE.md may omit it.
 */
import mongoose, { Schema, model, type Model, type Types } from 'mongoose';

/**
 * Register a Mongoose model idempotently.
 *
 * Mongoose keeps compiled models on a process-global registry, and `model(name, schema)` throws
 * `OverwriteModelError` if that name is already taken. Module code normally runs once, so this
 * rarely bites — until something re-evaluates a module in the same process: `tsx watch` on a
 * file change, or a test runner that shares one process across suites. Then every model file
 * throws on import and the failure looks nothing like its cause.
 *
 * Returning the already-compiled model makes re-import a no-op instead of a crash. The schema
 * argument is ignored on the second call, which is correct: the first registration defines the
 * shape for the lifetime of the process.
 *
 * The registry is read off the default export on purpose: mongoose is CommonJS, and `models` is
 * not one of the named bindings Node's ESM interop produces, so importing it by name compiles
 * under the test transform but throws at runtime under plain `node`/`tsx`.
 */
export function defineModel<T>(name: string, schema: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T> | undefined) ?? model<T>(name, schema);
}

export interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

/** The tenant key definition, reused verbatim so it can never be declared inconsistently. */
export const tenantKey = {
  type: Schema.Types.ObjectId,
  ref: 'Institution',
  required: true,
  index: true,
} as const;

export type ObjectId = Types.ObjectId;
