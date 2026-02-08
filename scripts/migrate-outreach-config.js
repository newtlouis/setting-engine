/**
 * One-shot migration: seed outreach config from config files into database.
 * Run: node scripts/migrate-outreach-config.js
 */

import Database from 'better-sqlite3';
import { loadProfileConfig } from '../shared/utils/configLoader.js';

const DB_PATH = 'agents/collector/permanent-data/leads.db';
const db = new Database(DB_PATH);

const accounts = db.prepare('SELECT * FROM accounts').all();

for (const account of accounts) {
  const profileConfig = await loadProfileConfig(account.name);
  if (!profileConfig) {
    console.log(`⏭️ No config file for "${account.name}", skipping.`);
    continue;
  }

  console.log(`\n📋 Migrating "${account.name}" (account_id: ${account.id})...`);

  // 1. Outreach templates
  const templates = [
    { type: 'follower', text: profileConfig.outreach?.follower_template },
    { type: 'like', text: profileConfig.outreach?.like_outreach_template },
    { type: 'comment', text: profileConfig.outreach?.comment_outreach_template },
  ];

  const insertTemplate = db.prepare(`
    INSERT OR REPLACE INTO outreach_templates (account_id, template_type, template_text)
    VALUES (?, ?, ?)
  `);

  for (const t of templates) {
    if (t.text) {
      insertTemplate.run(account.id, t.type, t.text);
      console.log(`  ✅ outreach template: ${t.type}`);
    }
  }

  // 2. Qualification prompt → account_personas
  if (profileConfig.outreach?.qualification_prompt) {
    db.prepare(`
      UPDATE account_personas SET qualification_prompt = ?, updated_at = datetime('now')
      WHERE account_id = ?
    `).run(profileConfig.outreach.qualification_prompt, account.id);
    console.log(`  ✅ qualification_prompt`);
  }

  // 3. CTA Resources
  const ctaResources = profileConfig.outreach?.cta_resources;
  if (ctaResources) {
    const insertCta = db.prepare(`
      INSERT OR REPLACE INTO cta_resources (account_id, keyword, resource_url, message_addon, outreach_template)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const [keyword, config] of Object.entries(ctaResources)) {
      insertCta.run(
        account.id,
        keyword,
        config.url || null,
        config.message_addon || null,
        config.outreach_template || null
      );
      console.log(`  ✅ cta resource: "${keyword}"`);
    }
  }

  // 4. Prospector sources
  const sources = profileConfig.prospector?.sources;
  if (sources && sources.length > 0) {
    const insertSource = db.prepare(`
      INSERT OR REPLACE INTO prospector_sources (account_id, source_value, source_order)
      VALUES (?, ?, ?)
    `);

    sources.forEach((source, index) => {
      insertSource.run(account.id, source, index);
    });
    console.log(`  ✅ ${sources.length} prospector sources`);
  }
}

console.log('\n✅ Migration complete.');
db.close();
