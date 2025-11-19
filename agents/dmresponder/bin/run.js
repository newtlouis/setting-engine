#!/usr/bin/env node

/**
 * DM Responder Agent CLI Entry Point
 * 
 * Generates contextual follow-up messages for Instagram DM conversations.
 */

import { program } from 'commander';
import dotenv from 'dotenv';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateResponse } from '../src/engine.js';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

program
  .name('dmresponder')
  .description('Instagram Lead Engine - DM Responder Agent')
  .version('1.0.0');

program
  .option('-c, --conversation <file>', 'Path to conversation_history.json', 'conversation_history.json')
  .option('-l, --lead <file>', 'Path to lead_context.json (optional)')
  .option('-b, --business <file>', 'Path to business_context.json (optional)')
  .option('-o, --output <file>', 'Output file for response', 'response.json')
  .option('--interactive', 'Interactive mode: prompt for user message', false)
  .action(async (options) => {
    try {
      console.log('💬 DM Responder Agent\n');

      console.log('⚠️  IMPORTANT REMINDERS:');
      console.log('   • This agent generates SUGGESTIONS only');
      console.log('   • ALWAYS review and personalize before sending');
      console.log('   • NEVER automate sending without human approval');
      console.log('   • Only use AFTER prospect replied to your manual first message\n');

      let conversationHistory;
      let leadContext = null;
      let businessContext = null;

      // Interactive mode
      if (options.interactive) {
        console.log('📝 Interactive mode\n');
        console.log('Enter the prospect\'s message (press Enter twice when done):');
        
        const userMessage = await readMultilineInput();
        
        conversationHistory = [
          {
            role: 'user',
            text: userMessage.trim()
          }
        ];

        console.log('\n✅ Message received\n');

      } else {
        // File mode
        try {
          const conversationData = await readFile(options.conversation, 'utf-8');
          conversationHistory = JSON.parse(conversationData);
        } catch (error) {
          console.error(`❌ Error reading conversation file: ${error.message}`);
          console.error('\nUsage:');
          console.error('  1. Create conversation_history.json with format:');
          console.error('     [{"role":"user","text":"..."},{"role":"assistant","text":"..."}]');
          console.error('  2. Run: dmresponder -c conversation_history.json\n');
          console.error('Or use --interactive mode to paste the message directly.\n');
          process.exit(1);
        }
      }

      // Load optional contexts
      if (options.lead) {
        try {
          const leadData = await readFile(options.lead, 'utf-8');
          leadContext = JSON.parse(leadData);
          console.log('📊 Lead context loaded\n');
        } catch (error) {
          console.log('ℹ️  No lead context provided (optional)\n');
        }
      }

      if (options.business) {
        try {
          const businessData = await readFile(options.business, 'utf-8');
          businessContext = JSON.parse(businessData);
          console.log('🏢 Business context loaded\n');
        } catch (error) {
          console.log('ℹ️  No business context provided (optional)\n');
        }
      }

      // Generate response
      console.log('🤖 Generating response...\n');

      const response = await generateResponse({
        conversationHistory,
        leadContext,
        businessContext
      });

      // Display response
      console.log('─'.repeat(60));
      console.log('💡 SUGGESTED RESPONSE:\n');
      console.log(response.next_message);
      console.log('\n' + '─'.repeat(60));
      console.log(`\n📍 Stage: ${response.conversation_stage}`);
      console.log(`📝 Type: ${response.message_type}`);
      console.log(`\n🧠 Reasoning:\n${response.reasoning}\n`);

      if (response.alternative_approaches && response.alternative_approaches.length > 0) {
        console.log('💭 Alternative approaches:');
        response.alternative_approaches.forEach((alt, i) => {
          console.log(`   ${i + 1}. ${alt}`);
        });
        console.log('');
      }

      if (response.next_steps && response.next_steps.length > 0) {
        console.log('📋 Suggested next steps:');
        response.next_steps.forEach((step, i) => {
          console.log(`   ${i + 1}. ${step}`);
        });
        console.log('');
      }

      // Save to file
      await writeFile(options.output, JSON.stringify(response, null, 2));
      console.log(`💾 Response saved to: ${options.output}\n`);

      console.log('⚠️  Remember to review and personalize before sending!\n');

    } catch (error) {
      console.error('\n❌ Error:', error.message);
      if (process.env.DEBUG === 'true') {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program.parse();

/**
 * Read multiline input from stdin (ends with empty line)
 */
function readMultilineInput() {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    let lines = [];
    let emptyLineCount = 0;
    
    rl.on('line', (line) => {
      if (line.trim() === '') {
        emptyLineCount++;
        if (emptyLineCount >= 2) {
          rl.close();
          resolve(lines.join('\n'));
        }
      } else {
        emptyLineCount = 0;
        lines.push(line);
      }
    });
  });
}
