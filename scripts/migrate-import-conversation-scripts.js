#!/usr/bin/env node
/**
 * Migration: Import conversation scripts from config file to database
 *
 * This script:
 * 1. Reads the system_prompt from each profile's config file
 * 2. Parses and extracts individual step scripts
 * 3. Saves them to funnel_stages.conversation_script
 * 4. Creates account_personas records
 *
 * Usage: node scripts/migrate-import-conversation-scripts.js [--profile=name]
 */

import { getContainer } from '../shared/container.js';
import { loadProfileConfig } from '../shared/utils/configLoader.js';
import { getDefaultConversationScripts } from '../shared/domain/services/PromptComposer.js';
import { AccountPersona } from '../shared/domain/entities/AccountPersona.js';

/**
 * Parse step scripts from a system prompt
 * Returns a map of step number -> script text
 */
function parseStepScripts(systemPrompt) {
  const scripts = {};

  if (!systemPrompt) return scripts;

  // Split by step markers like [STEP_1], [STEP_2], etc.
  // We need to capture everything from one [STEP_X] to the next
  const stepPattern = /\[STEP_(\d+(?:\.\d+)?)\][^\[]*(?:\[STEP_\d+(?:\.\d+)?\][^\[]*)*/gi;
  const sectionPattern = /(\[STEP_(\d+)\][\s\S]*?)(?=\n---|\n\[STEP_|\n🛡️|\n🧠|\n🧩|\n⚠️ RÈGLE FINALE|$)/gi;

  // Try to extract major step sections
  let match;
  const fullText = systemPrompt;

  // Find all STEP markers and their positions
  const stepPositions = [];
  const markerPattern = /\[STEP_(\d+)(?:\.\d+)?\]/gi;
  while ((match = markerPattern.exec(fullText)) !== null) {
    const mainStep = parseInt(match[1], 10);
    if (!stepPositions.find(p => p.step === mainStep)) {
      stepPositions.push({ step: mainStep, index: match.index });
    }
  }

  // Extract content for each step
  for (let i = 0; i < stepPositions.length; i++) {
    const current = stepPositions[i];
    const next = stepPositions[i + 1];

    let endIndex;
    if (next) {
      // Find the separator between steps (usually ---)
      const contentBetween = fullText.substring(current.index, next.index);
      const separatorMatch = contentBetween.lastIndexOf('\n---');
      if (separatorMatch !== -1) {
        endIndex = current.index + separatorMatch;
      } else {
        endIndex = next.index;
      }
    } else {
      // Last step - find end markers
      const remaining = fullText.substring(current.index);
      const endMarkers = ['🛡️ GESTION DES OBJECTIONS', '🧠 GESTION DES CONCURRENTS', '🧩', '⚠️ RÈGLE FINALE'];
      let minEnd = remaining.length;
      for (const marker of endMarkers) {
        const pos = remaining.indexOf(marker);
        if (pos !== -1 && pos < minEnd) {
          minEnd = pos;
        }
      }
      endIndex = current.index + minEnd;
    }

    const stepContent = fullText.substring(current.index, endIndex).trim();
    scripts[current.step] = stepContent;
  }

  return scripts;
}

/**
 * Extract persona info from config
 */
function extractPersonaInfo(profileConfig) {
  const systemPrompt = profileConfig?.dm_responder?.system_prompt || '';

  // Try to extract persona name from prompt
  let personaName = profileConfig.profile_name || 'Assistant';

  // Look for patterns like "Tu es Melanie" or "Tu t'appelles Mélanie"
  const nameMatch = systemPrompt.match(/tu (?:es|t'appelles|t'appelle) (\w+)/i);
  if (nameMatch) {
    personaName = nameMatch[1];
  }

  return {
    personaName,
    niche: profileConfig.niche || '',
    postBookingMessage: profileConfig.post_booking_message || null
  };
}

/**
 * Extract objections script from system prompt
 */
function extractObjectionsScript(systemPrompt) {
  if (!systemPrompt) return null;

  // Find objections section
  const patterns = [
    /🛡️ GESTION DES OBJECTIONS[\s\S]*?(?=\n🧠|\n🧩|\n⚠️|$)/i,
    /GESTION DES OBJECTIONS[\s\S]*?(?=\n🧠|\n🧩|\n⚠️|$)/i,
    /\*\*OBJECTIONS COURANTES\*\*[\s\S]*?(?=\n---|\n\[STEP|$)/i
  ];

  for (const pattern of patterns) {
    const match = systemPrompt.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }

  return null;
}

async function migrate() {
  console.log('=== Migration: Import Conversation Scripts ===\n');

  const args = process.argv.slice(2);
  const profileArg = args.find(a => a.startsWith('--profile='));
  const specificProfile = profileArg ? profileArg.split('=')[1] : null;

  const container = await getContainer();
  const db = container.getDb();
  const funnelRepo = container.repositories.funnel;

  try {
    // Get all accounts (or specific one)
    let accounts;
    if (specificProfile) {
      const account = db.prepare('SELECT * FROM accounts WHERE name = ?').get(specificProfile);
      if (!account) {
        console.error(`❌ Account "${specificProfile}" not found.`);
        process.exit(1);
      }
      accounts = [account];
    } else {
      accounts = db.prepare('SELECT * FROM accounts').all();
    }

    console.log(`Found ${accounts.length} account(s) to process.\n`);

    for (const account of accounts) {
      console.log(`--- Processing account: ${account.name} (ID: ${account.id}) ---`);

      // 1. Load profile config
      let profileConfig;
      try {
        profileConfig = await loadProfileConfig(account.name);
      } catch (err) {
        console.log(`   ⚠️ No config file found for ${account.name}. Using defaults.`);
        profileConfig = null;
      }

      // 2. Get existing stages
      const stages = await funnelRepo.getStagesForAccount(account.id);
      if (stages.length === 0) {
        console.log(`   ⚠️ No funnel stages found. Run migrate-init-funnel-stages.js first.`);
        continue;
      }

      // 3. Parse step scripts from config or use defaults
      let stepScripts;
      if (profileConfig?.dm_responder?.system_prompt) {
        console.log(`   Parsing conversation scripts from config...`);
        stepScripts = parseStepScripts(profileConfig.dm_responder.system_prompt);
      } else {
        console.log(`   Using default conversation scripts...`);
        stepScripts = getDefaultConversationScripts();
      }

      console.log(`   Found ${Object.keys(stepScripts).length} step scripts.`);

      // 4. Update each stage with its conversation script
      let updatedCount = 0;
      for (const stage of stages) {
        const script = stepScripts[stage.stageOrder];
        if (script && !stage.conversationScript) {
          stage.conversationScript = script;
          await funnelRepo.saveStage(stage);
          updatedCount++;
        }
      }
      console.log(`   ✅ Updated ${updatedCount} stages with conversation scripts.`);

      // 5. Create/update account persona
      if (profileConfig) {
        const personaInfo = extractPersonaInfo(profileConfig);
        const objectionsScript = extractObjectionsScript(profileConfig.dm_responder?.system_prompt);

        const existingPersona = await funnelRepo.getPersonaForAccount(account.id);

        if (!existingPersona) {
          const persona = AccountPersona.create(account.id, personaInfo.personaName, {
            niche: personaInfo.niche,
            objectionsScript: objectionsScript,
            postBookingMessage: personaInfo.postBookingMessage
          });

          await funnelRepo.savePersona(persona);
          console.log(`   ✅ Created persona: ${personaInfo.personaName}`);
        } else {
          console.log(`   ℹ️  Persona already exists: ${existingPersona.personaName}`);
        }
      }

      console.log('');
    }

    // Summary
    console.log('=== Summary ===\n');

    const stagesWithScripts = db.prepare(`
      SELECT COUNT(*) as count FROM funnel_stages WHERE conversation_script IS NOT NULL
    `).get();

    const personaCount = db.prepare(`
      SELECT COUNT(*) as count FROM account_personas
    `).get();

    console.log(`Stages with conversation scripts: ${stagesWithScripts.count}`);
    console.log(`Account personas: ${personaCount.count}`);

    console.log('\n✅ Migration complete!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

migrate();
