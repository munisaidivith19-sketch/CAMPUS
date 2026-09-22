/**
 * @campusconnect/validation — shared Zod schemas.
 *
 * These schemas are the ONE definition of each contract. The server uses them to validate
 * requests; web/mobile forms use them to validate input and to infer TS types. Domain
 * schemas (auth, attendance, …) are added in the phase that delivers the feature.
 */

export * from './common.js';
export * from './auth.js';
export * from './identity.js';
