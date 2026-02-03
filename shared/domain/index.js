/**
 * Domain Layer Index
 *
 * Central export for all domain entities, value objects, and services.
 * This is the public API of the domain layer.
 *
 * Usage:
 *   import { Lead, LeadStatus, SpamDetector } from '../shared/domain/index.js';
 */

// Value Objects
export * from './value-objects/index.js';

// Entities
export * from './entities/index.js';

// Domain Services
export * from './services/index.js';
