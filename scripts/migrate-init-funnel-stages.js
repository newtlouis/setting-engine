#!/usr/bin/env node
/**
 * Migration: Initialize funnel stages for existing accounts
 *
 * Creates default funnel stages and migrates templates from config files.
 *
 * Usage: node scripts/migrate-init-funnel-stages.js
 */

import { getContainer } from '../shared/container.js';
import { loadProfileConfig } from '../shared/utils/configLoader.js';

async function migrate() {
  console.log('=== Migration: Initialize Funnel Stages ===\n');

  const container = await getContainer();
  const db = container.getDb();

  try {
    // Get all accounts
    const accounts = db.prepare('SELECT * FROM accounts').all();
    console.log(`Found ${accounts.length} account(s).\n`);

    for (const account of accounts) {
      console.log(`--- Processing account: ${account.name} (ID: ${account.id}) ---`);

      // Check if already has funnel config
      const hasConfig = await container.repositories.funnel.hasFunnelConfig(account.id);

      if (hasConfig) {
        console.log('   ✅ Already has funnel stages. Skipping.\n');
        continue;
      }

      // Initialize default stages
      console.log('   Creating default funnel stages...');
      const stages = await container.repositories.funnel.initializeDefaultStages(account.id);
      console.log(`   ✅ Created ${stages.length} stages.`);

      // Try to load profile config and migrate templates
      try {
        const profileConfig = await loadProfileConfig(account.name);
        const followups = profileConfig?.outreach?.followups;

        if (followups) {
          console.log('   Migrating templates from config file...');

          let templatesCreated = 0;

          for (const stage of stages) {
            // Map stage name to config key (step1, step2, etc.)
            const configKey = `step${stage.stageOrder}`;
            const stageConfig = followups[configKey];

            if (stageConfig?.templates?.length > 0) {
              for (let i = 0; i < stageConfig.templates.length; i++) {
                const { FollowupTemplate } = await import('../shared/domain/entities/FollowupTemplate.js');
                const template = FollowupTemplate.create(
                  stage.id,
                  account.id,
                  i,
                  stageConfig.templates[i],
                  `Relance ${i + 1}`
                );
                await container.repositories.funnel.saveTemplate(template);
                templatesCreated++;
              }
            }
          }

          console.log(`   ✅ Migrated ${templatesCreated} templates from config.`);
        }
      } catch (err) {
        console.log(`   ⚠️ Could not load profile config: ${err.message}`);
        console.log('   → Default stages created without templates.');
      }

      console.log('');
    }

    // Show summary
    console.log('\n=== Summary ===\n');

    const stageCount = db.prepare('SELECT COUNT(*) as count FROM funnel_stages').get();
    const templateCount = db.prepare('SELECT COUNT(*) as count FROM followup_templates').get();

    console.log(`Total funnel stages: ${stageCount.count}`);
    console.log(`Total followup templates: ${templateCount.count}`);

    // Show per-account breakdown
    const breakdown = db.prepare(`
      SELECT a.name,
             COUNT(DISTINCT fs.id) as stages,
             COUNT(DISTINCT ft.id) as templates
      FROM accounts a
      LEFT JOIN funnel_stages fs ON a.id = fs.account_id
      LEFT JOIN followup_templates ft ON a.id = ft.account_id
      GROUP BY a.id
    `).all();

    console.log('\nPer-account breakdown:');
    for (const row of breakdown) {
      console.log(`   ${row.name}: ${row.stages} stages, ${row.templates} templates`);
    }

    console.log('\n✅ Migration complete!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

migrate();
