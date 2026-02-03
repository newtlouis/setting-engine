/**
 * Infrastructure Layer Index
 *
 * Central export for all infrastructure implementations.
 * This is the public API of the infrastructure layer.
 *
 * Usage:
 *   import { createSqliteLeadRepository } from '../shared/infrastructure/index.js';
 *
 *   const leadRepo = createSqliteLeadRepository({ getDb });
 */

// Repository Implementations
export * from './repositories/index.js';

// Re-export database core for convenience
// Note: DB core lives in collector agent as the original source of truth.
// This re-export provides a stable import path for shared infrastructure.
export { initDatabase, getDb, closeDatabase } from '../../agents/collector/src/db/core.js';
