/**
 * @campusconnect/types — shared contracts for server, web, and mobile.
 *
 * This is the single source of truth for enums and cross-cutting types. The server
 * validates against these; the clients infer from them. Domain DTOs are added per phase.
 */

export * from './roles.js';
export * from './rbac.js';
export * from './api.js';
export * from './identity.js';
export * from './academics.js';
export * from './community.js';
export * from './chat.js';
export * from './files.js';
export * from './dashboards.js';
