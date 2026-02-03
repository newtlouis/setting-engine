/**
 * SQLite Database Module - FACADE
 *
 * Central database for all lead data, shared across agents.
 * This file is now a facade that re-exports all functions from the split db modules.
 *
 * For backward compatibility, all existing imports continue to work:
 *   import { initDatabase, getLeads, ... } from './database.js'
 *
 * New code can also import directly from modules:
 *   import { getLeads } from './db/leads.js'
 */

// Re-export everything from the split modules
export * from './db/index.js';
