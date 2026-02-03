/**
 * Dependency Injection Container
 *
 * Wires together all layers of the Clean Architecture.
 * Provides a simple way to get configured use cases and repositories.
 *
 * Usage:
 *   import { getContainer } from '../shared/container.js';
 *
 *   const container = await getContainer();
 *   const result = await container.useCases.saveLeadsFromComments.execute(comments, accountId);
 */

import { initDatabase, getDb, closeDatabase } from './infrastructure/index.js';
import {
  createSqliteLeadRepository,
  createSqliteConversationRepository,
  createSqliteAccountRepository,
  createSqliteOutreachQueueRepository
} from './infrastructure/index.js';
import {
  SaveLeadsFromComments,
  QualifyLeads,
  GetLeadsForOutreach,
  RecordMessage,
  GetConversationHistory,
  PrepareOutreachBatch,
  MarkMessageSent
} from './application/index.js';
import {
  SpamDetector,
  EngagementScorer,
  LeadQualifier
} from './domain/index.js';

let container = null;

/**
 * Container holding all wired dependencies
 */
class Container {
  constructor() {
    this.repositories = {};
    this.useCases = {};
    this.services = {};
    this._initialized = false;
  }

  /**
   * Initialize the container with database connection
   * @param {string} [dbPath] - Optional database path
   */
  async initialize(dbPath = undefined) {
    if (this._initialized) return;

    // Initialize database
    await initDatabase(dbPath);

    // Create repositories
    this.repositories = {
      lead: createSqliteLeadRepository({ getDb }),
      conversation: createSqliteConversationRepository({ getDb }),
      account: createSqliteAccountRepository({ getDb }),
      outreachQueue: createSqliteOutreachQueueRepository({ getDb })
    };

    // Domain services (stateless, no dependencies)
    this.services = {
      spamDetector: SpamDetector,
      engagementScorer: EngagementScorer,
      leadQualifier: LeadQualifier
    };

    // Create use cases with dependencies
    this.useCases = {
      saveLeadsFromComments: new SaveLeadsFromComments({
        leadRepository: this.repositories.lead
      }),

      qualifyLeads: new QualifyLeads({
        leadRepository: this.repositories.lead
      }),

      getLeadsForOutreach: new GetLeadsForOutreach({
        leadRepository: this.repositories.lead
      }),

      recordMessage: new RecordMessage({
        leadRepository: this.repositories.lead,
        conversationRepository: this.repositories.conversation
      }),

      getConversationHistory: new GetConversationHistory({
        leadRepository: this.repositories.lead,
        conversationRepository: this.repositories.conversation
      }),

      prepareOutreachBatch: new PrepareOutreachBatch({
        leadRepository: this.repositories.lead,
        outreachQueueRepository: this.repositories.outreachQueue
      }),

      markMessageSent: new MarkMessageSent({
        leadRepository: this.repositories.lead,
        conversationRepository: this.repositories.conversation,
        outreachQueueRepository: this.repositories.outreachQueue
      })
    };

    this._initialized = true;
  }

  /**
   * Check if container is initialized
   */
  get isInitialized() {
    return this._initialized;
  }

  /**
   * Close database connection and reset container
   */
  async close() {
    closeDatabase();
    this._initialized = false;
    this.repositories = {};
    this.useCases = {};
  }

  /**
   * Get raw database instance (for legacy code migration)
   */
  getDb() {
    return getDb();
  }
}

/**
 * Get the singleton container instance
 * @param {string} [dbPath] - Optional database path
 * @returns {Promise<Container>}
 */
export async function getContainer(dbPath = undefined) {
  if (!container) {
    container = new Container();
  }

  if (!container.isInitialized) {
    await container.initialize(dbPath);
  }

  return container;
}

/**
 * Reset the container (for testing)
 */
export async function resetContainer() {
  if (container) {
    await container.close();
    container = null;
  }
}

/**
 * Quick access to use cases (after initialization)
 */
export function getUseCases() {
  if (!container || !container.isInitialized) {
    throw new Error('Container not initialized. Call getContainer() first.');
  }
  return container.useCases;
}

/**
 * Quick access to repositories (after initialization)
 */
export function getRepositories() {
  if (!container || !container.isInitialized) {
    throw new Error('Container not initialized. Call getContainer() first.');
  }
  return container.repositories;
}

/**
 * Quick access to domain services
 */
export function getServices() {
  return {
    spamDetector: SpamDetector,
    engagementScorer: EngagementScorer,
    leadQualifier: LeadQualifier
  };
}

export { Container };
export default getContainer;
