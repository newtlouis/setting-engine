/**
 * Test Scenarios Database Module
 *
 * Handles test scenario CRUD operations for conversation testing.
 */

import { getDb } from './core.js';

/**
 * Create a new test scenario
 * @param {string} name - Scenario name
 * @param {Array} messages - Array of {role, text}
 * @returns {Object} Created scenario
 */
export function createScenario(name, messages) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO test_scenarios (name, messages)
    VALUES (?, ?)
    RETURNING *
  `);
  return stmt.get(name, JSON.stringify(messages));
}

/**
 * Get all test scenarios
 * @returns {Array} All scenarios
 */
export function getScenarios() {
  const db = getDb();
  const scenarios = db.prepare(`
    SELECT * FROM test_scenarios
    ORDER BY created_at DESC
  `).all();

  return scenarios.map(s => ({
    ...s,
    messages: JSON.parse(s.messages)
  }));
}

/**
 * Get a scenario by ID
 * @param {number} id - Scenario ID
 * @returns {Object|null} Scenario
 */
export function getScenarioById(id) {
  const db = getDb();
  const scenario = db.prepare(`
    SELECT * FROM test_scenarios WHERE id = ?
  `).get(id);

  if (!scenario) return null;

  return {
    ...scenario,
    messages: JSON.parse(scenario.messages)
  };
}

/**
 * Delete a scenario
 * @param {number} id - Scenario ID
 */
export function deleteScenario(id) {
  const db = getDb();
  return db.prepare('DELETE FROM test_scenarios WHERE id = ?').run(id);
}

/**
 * Update a scenario's messages
 * @param {number} id - Scenario ID
 * @param {Array} messages - New message list
 */
export function updateScenario(id, messages) {
  const db = getDb();
  return db.prepare(`
    UPDATE test_scenarios
    SET messages = ?, created_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(JSON.stringify(messages), id);
}

/**
 * Save scenario test result
 * @param {number} scenarioId - Scenario ID
 * @param {Array} messages - Complete conversation with AI responses
 */
export function saveScenarioResult(scenarioId, messages) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO test_scenario_results (scenario_id, messages)
    VALUES (?, ?)
    RETURNING *
  `);
  return stmt.get(scenarioId, JSON.stringify(messages));
}

/**
 * Get latest results for a scenario
 * @param {number} scenarioId - Scenario ID
 * @param {number} limit - Number of results to return
 * @returns {Array} Results
 */
export function getScenarioResults(scenarioId, limit = 5) {
  const db = getDb();
  const results = db.prepare(`
    SELECT * FROM test_scenario_results
    WHERE scenario_id = ?
    ORDER BY tested_at DESC
    LIMIT ?
  `).all(scenarioId, limit);

  return results.map(r => ({
    ...r,
    messages: JSON.parse(r.messages)
  }));
}
