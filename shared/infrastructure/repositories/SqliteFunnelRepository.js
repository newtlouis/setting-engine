/**
 * SQLite Funnel Repository
 *
 * Manages funnel stages and followup templates in the database.
 */

import { FunnelStage } from '../../domain/entities/FunnelStage.js';
import { FollowupTemplate } from '../../domain/entities/FollowupTemplate.js';
import { AccountPersona } from '../../domain/entities/AccountPersona.js';

/**
 * Create SQLite Funnel Repository
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getDb - Function to get database instance
 * @returns {Object} Repository implementation
 */
export function createSqliteFunnelRepository({ getDb }) {
  return {
    // ==================== FUNNEL STAGES ====================

    /**
     * Get all stages for an account
     */
    async getStagesForAccount(accountId) {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM funnel_stages
        WHERE account_id = ? AND is_active = 1
        ORDER BY stage_order ASC
      `).all(accountId);

      return rows.map(row => FunnelStage.fromDbRow(row));
    },

    /**
     * Get stage by order number
     */
    async getStageByOrder(accountId, stageOrder) {
      const db = getDb();
      const row = db.prepare(`
        SELECT * FROM funnel_stages
        WHERE account_id = ? AND stage_order = ?
      `).get(accountId, stageOrder);

      return FunnelStage.fromDbRow(row);
    },

    /**
     * Get stage by label (e.g., "STEP_3")
     */
    async getStageByLabel(accountId, stageLabel) {
      const db = getDb();
      const row = db.prepare(`
        SELECT * FROM funnel_stages
        WHERE account_id = ? AND stage_label = ?
      `).get(accountId, stageLabel);

      return FunnelStage.fromDbRow(row);
    },

    /**
     * Save a funnel stage
     */
    async saveStage(stage) {
      const db = getDb();
      const data = stage.toDbRow();

      if (stage.id) {
        db.prepare(`
          UPDATE funnel_stages SET
            stage_order = @stage_order,
            stage_name = @stage_name,
            stage_label = @stage_label,
            description = @description,
            conversation_script = @conversation_script,
            max_followups = @max_followups,
            followup_delay_hours = @followup_delay_hours,
            auto_ignore_after_max = @auto_ignore_after_max,
            is_active = @is_active,
            updated_at = datetime('now')
          WHERE id = @id
        `).run(data);
        return stage;
      } else {
        const result = db.prepare(`
          INSERT INTO funnel_stages (
            account_id, stage_order, stage_name, stage_label,
            description, conversation_script, max_followups, followup_delay_hours,
            auto_ignore_after_max, is_active
          ) VALUES (
            @account_id, @stage_order, @stage_name, @stage_label,
            @description, @conversation_script, @max_followups, @followup_delay_hours,
            @auto_ignore_after_max, @is_active
          )
          ON CONFLICT(account_id, stage_order) DO UPDATE SET
            stage_name = excluded.stage_name,
            stage_label = excluded.stage_label,
            description = excluded.description,
            conversation_script = excluded.conversation_script,
            max_followups = excluded.max_followups,
            followup_delay_hours = excluded.followup_delay_hours,
            auto_ignore_after_max = excluded.auto_ignore_after_max,
            updated_at = datetime('now')
          RETURNING *
        `).get(data);

        return FunnelStage.fromDbRow(result);
      }
    },

    /**
     * Delete a funnel stage
     */
    async deleteStage(stageId) {
      const db = getDb();
      const result = db.prepare(`
        DELETE FROM funnel_stages WHERE id = ?
      `).run(stageId);

      return result.changes > 0;
    },

    /**
     * Initialize default stages for a new account
     */
    async initializeDefaultStages(accountId) {
      const defaultStages = [
        { order: 1, name: 'premier_contact', label: 'STEP_1', maxFollowups: 0, desc: 'Premier message envoyé' },
        { order: 2, name: 'connexion', label: 'STEP_2', maxFollowups: 1, autoIgnore: true, desc: 'Après première réponse' },
        { order: 3, name: 'exploration', label: 'STEP_3', maxFollowups: 3, desc: 'Exploration du vécu' },
        { order: 4, name: 'projection', label: 'STEP_4', maxFollowups: 3, desc: 'Objectifs et projection' },
        { order: 5, name: 'proposition_appel', label: 'STEP_5', maxFollowups: 3, desc: 'Proposition d\'appel' },
        { order: 6, name: 'creneaux', label: 'STEP_6', maxFollowups: 2, desc: 'Proposition de créneaux' },
        { order: 7, name: 'infos_contact', label: 'STEP_7', maxFollowups: 1, desc: 'Récupération email/tel' },
        { order: 8, name: 'confirmation', label: 'STEP_8', maxFollowups: 0, desc: 'RDV confirmé' },
        { order: 9, name: 'cloture', label: 'STEP_9', maxFollowups: 0, desc: 'Fin du workflow' }
      ];

      const stages = [];
      for (const s of defaultStages) {
        const stage = FunnelStage.create(accountId, s.order, s.name, s.label, {
          maxFollowups: s.maxFollowups,
          autoIgnoreAfterMax: s.autoIgnore || false,
          description: s.desc
        });
        const saved = await this.saveStage(stage);
        stages.push(saved);
      }

      return stages;
    },

    // ==================== FOLLOWUP TEMPLATES ====================

    /**
     * Get all templates for a stage
     */
    async getTemplatesForStage(stageId) {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM followup_templates
        WHERE stage_id = ? AND is_active = 1
        ORDER BY template_order ASC
      `).all(stageId);

      return rows.map(row => FollowupTemplate.fromDbRow(row));
    },

    /**
     * Get all templates for an account (all stages)
     */
    async getTemplatesForAccount(accountId) {
      const db = getDb();
      const rows = db.prepare(`
        SELECT ft.*, fs.stage_name, fs.stage_order
        FROM followup_templates ft
        JOIN funnel_stages fs ON ft.stage_id = fs.id
        WHERE ft.account_id = ? AND ft.is_active = 1
        ORDER BY fs.stage_order, ft.template_order
      `).all(accountId);

      return rows.map(row => ({
        ...FollowupTemplate.fromDbRow(row).toJSON(),
        stageName: row.stage_name,
        stageOrder: row.stage_order
      }));
    },

    /**
     * Get template by stage and order
     */
    async getTemplateByOrder(stageId, templateOrder) {
      const db = getDb();
      const row = db.prepare(`
        SELECT * FROM followup_templates
        WHERE stage_id = ? AND template_order = ?
      `).get(stageId, templateOrder);

      return FollowupTemplate.fromDbRow(row);
    },

    /**
     * Save a followup template
     */
    async saveTemplate(template) {
      const db = getDb();
      const data = template.toDbRow();

      if (template.id) {
        db.prepare(`
          UPDATE followup_templates SET
            template_order = @template_order,
            template_text = @template_text,
            template_name = @template_name,
            is_active = @is_active,
            usage_count = @usage_count,
            success_count = @success_count,
            updated_at = datetime('now')
          WHERE id = @id
        `).run(data);
        return template;
      } else {
        const result = db.prepare(`
          INSERT INTO followup_templates (
            stage_id, account_id, template_order,
            template_text, template_name, is_active
          ) VALUES (
            @stage_id, @account_id, @template_order,
            @template_text, @template_name, @is_active
          )
          ON CONFLICT(stage_id, template_order) DO UPDATE SET
            template_text = excluded.template_text,
            template_name = excluded.template_name,
            updated_at = datetime('now')
          RETURNING *
        `).get(data);

        return FollowupTemplate.fromDbRow(result);
      }
    },

    /**
     * Delete a template
     */
    async deleteTemplate(templateId) {
      const db = getDb();
      const result = db.prepare(`
        DELETE FROM followup_templates WHERE id = ?
      `).run(templateId);

      return result.changes > 0;
    },

    /**
     * Record template usage and success
     */
    async recordTemplateUsage(templateId, gotReply = false) {
      const db = getDb();

      if (gotReply) {
        db.prepare(`
          UPDATE followup_templates
          SET usage_count = usage_count + 1,
              success_count = success_count + 1,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(templateId);
      } else {
        db.prepare(`
          UPDATE followup_templates
          SET usage_count = usage_count + 1,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(templateId);
      }
    },

    // ==================== COMBINED QUERIES ====================

    /**
     * Get full funnel config for an account (stages + templates)
     */
    async getFullFunnelConfig(accountId) {
      const stages = await this.getStagesForAccount(accountId);

      const config = {};
      for (const stage of stages) {
        const templates = await this.getTemplatesForStage(stage.id);
        config[stage.stageName] = {
          ...stage.toJSON(),
          templates: templates.map(t => t.toJSON())
        };
      }

      return config;
    },

    /**
     * Check if account has funnel stages configured
     */
    async hasFunnelConfig(accountId) {
      const db = getDb();
      const row = db.prepare(`
        SELECT COUNT(*) as count FROM funnel_stages WHERE account_id = ?
      `).get(accountId);

      return row.count > 0;
    },

    // ==================== ACCOUNT PERSONAS ====================

    /**
     * Get persona for an account
     */
    async getPersonaForAccount(accountId) {
      const db = getDb();
      const row = db.prepare(`
        SELECT * FROM account_personas WHERE account_id = ?
      `).get(accountId);

      return AccountPersona.fromDbRow(row);
    },

    /**
     * Save account persona
     */
    async savePersona(persona) {
      const db = getDb();
      const data = persona.toDbRow();

      if (persona.id) {
        db.prepare(`
          UPDATE account_personas SET
            persona_name = @persona_name,
            niche = @niche,
            communication_rules = @communication_rules,
            objections_script = @objections_script,
            knowledge_base = @knowledge_base,
            post_booking_message = @post_booking_message,
            updated_at = datetime('now')
          WHERE id = @id
        `).run(data);
        return persona;
      } else {
        const result = db.prepare(`
          INSERT INTO account_personas (
            account_id, persona_name, niche,
            communication_rules, objections_script, knowledge_base,
            post_booking_message
          ) VALUES (
            @account_id, @persona_name, @niche,
            @communication_rules, @objections_script, @knowledge_base,
            @post_booking_message
          )
          ON CONFLICT(account_id) DO UPDATE SET
            persona_name = excluded.persona_name,
            niche = excluded.niche,
            communication_rules = excluded.communication_rules,
            objections_script = excluded.objections_script,
            knowledge_base = excluded.knowledge_base,
            post_booking_message = excluded.post_booking_message,
            updated_at = datetime('now')
          RETURNING *
        `).get(data);

        return AccountPersona.fromDbRow(result);
      }
    },

    /**
     * Delete account persona
     */
    async deletePersona(accountId) {
      const db = getDb();
      const result = db.prepare(`
        DELETE FROM account_personas WHERE account_id = ?
      `).run(accountId);

      return result.changes > 0;
    },

    // ==================== PROMPT COMPOSITION ====================

    /**
     * Get all data needed for prompt composition
     */
    async getPromptData(accountId) {
      const persona = await this.getPersonaForAccount(accountId);
      const stages = await this.getStagesForAccount(accountId);

      return {
        persona,
        stages
      };
    }
  };
}

export default createSqliteFunnelRepository;
