/**
 * Application Layer Index
 *
 * Central export for all use cases and repository interfaces.
 * This is the public API of the application layer.
 *
 * Usage:
 *   import { SaveLeadsFromComments, ILeadRepository } from '../shared/application/index.js';
 */

// Ports (Repository Interfaces)
export * from './ports/index.js';

// Use Cases
export * from './use-cases/index.js';
