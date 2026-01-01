#!/usr/bin/env node

/**
 * DM Responder Agent CLI Entry Point
 * 
 * Generates contextual follow-up messages for Instagram DM conversations.
 * 
 * Modes:
 * - Interactive: Paste message directly
 * - File: Load from conversation_history.json
 * - Database: Load from SQLite database by username
 */

import { program } from 'commander';
import dotenv from 'dotenv';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateResponse } from '../src/engine.js';
import { scrapeConversation, fillMessageAndLeaveOpen } from '../src/scraper.js';
import { createInterface } from 'readline';
import {
  initDB,
  getLeadWithContext,
  getConversationHistory,
  addMessage,
  updateConversationStage,
  getActiveConversations,
  getConversationSummary
} from '../src/db_integration.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

program
  .name('dmresponder')
  .description('Instagram Lead Engine - DM Responder Agent')
  .version('1.0.0');

program
  .option('--url <url>', 'Scrape conversation history from an Instagram DM URL')
  .option('-c, --conversation <file>', 'Path to conversation_history.json')
  .option('-l, --lead <file>', 'Path to lead_context.json (optional)')
  .option('-b, --business <file>', 'Path to business_context.json (optional)')
  .option('-o, --output <file>', 'Output file for response', 'response.json')
  .option('-u, --username <username>', 'Load conversation from database by username')
  .option('-m, --message <text>', 'User message to respond to (with --username)')
  .option('--interactive', 'Interactive mode: prompt for user message', false)
  .option('--list', 'List active conversations from database', false)
  .option('--save', 'Save response to database (with --username)', false)
  .option('--profile <name>', 'Browser profile name', 'default')
  .action(async (options) => {
    try {
      console.log('\n=== DM Responder Agent ===\n');

      // Resolve Account ID
      const { getOrCreateAccount, initDatabase } = await import('../../collector/src/database.js');
      await initDatabase();
      const account = getOrCreateAccount(options.profile);
      const accountId = account.id;
      console.log(`👤 Profile: ${options.profile} (Account ID: ${accountId})`);
      process.env.IG_PROFILE = options.profile;

      console.log('REMINDERS:');
      console.log('  - This agent generates SUGGESTIONS only');
      console.log('  - ALWAYS review and personalize before sending');
      console.log('  - NEVER automate sending without human approval\n');

      // List mode: show active conversations
      if (options.list) {
        await handleListMode(accountId);
        return;
      }

      let conversationHistory;
      let leadContext = null;
      let businessContext = null;
      let currentUsername = null;
      let page, browser; // To hold the browser session

      // URL mode: scrape the conversation first
      if (options.url) {
        const scrapeResult = await scrapeConversation(options.url, { profile: options.profile });
        conversationHistory = scrapeResult.conversationHistory;
        page = scrapeResult.page;
        browser = scrapeResult.browser;
        
      // Database mode: load by username
      } else if (options.username) {
        currentUsername = options.username;
        const result = await handleDatabaseMode(options, accountId);
        conversationHistory = result.conversationHistory;
        leadContext = result.leadContext;
        
      // Interactive mode
      } else if (options.interactive) {
        conversationHistory = await handleInteractiveMode();
        
      // File mode
      } else {
        const conversationFile = options.conversation || 'conversation_history.json';
        conversationHistory = await handleFileMode(conversationFile);
      }

      // Load optional contexts from files
      if (options.lead && !leadContext) {
        try {
          const leadData = await readFile(options.lead, 'utf-8');
          leadContext = JSON.parse(leadData);
          console.log('Lead context loaded from file\n');
        } catch (error) {
          // Ignore
        }
      }

      if (options.business) {
        try {
          const businessData = await readFile(options.business, 'utf-8');
          businessContext = JSON.parse(businessData);
          console.log('Business context loaded\n');
        } catch (error) {
          // Ignore
        }
      }

      // Generate response
      console.log('Generating response...\n');

      const response = await generateResponse({
        conversationHistory,
        leadContext,
        businessContext
      });

      // Display response
      displayResponse(response, leadContext);

      // Save to file
      await writeFile(options.output, JSON.stringify(response, null, 2));
      console.log(`Response saved to: ${options.output}\n`);

      // Save to database if requested
      if (options.save && currentUsername) {
        await addMessage(currentUsername, 'assistant', response.next_message, response.message_type, accountId);
        await updateConversationStage(currentUsername, response.conversation_stage);
        console.log(`Response saved to database for @${currentUsername}\n`);
      }

      // If in URL mode, fill the response in the browser
      if (options.url && page) {
        await fillMessageAndLeaveOpen(page, response.next_message);
      } else {
        console.log('Remember to review and personalize before sending!\n');
      }


    } catch (error) {
      console.error('\nERROR:', error.message);
      if (process.env.DEBUG === 'true') {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program.parse();

/**
 * Handle database mode
 */
async function handleDatabaseMode(options, accountId) {
  const username = options.username;
  console.log(`Loading data for @${username} from database...\n`);
  
  await initDB();
  
  // Get lead context
  const leadContext = await getLeadWithContext(username, accountId);
  if (!leadContext) {
    throw new Error(`Lead not found: @${username}`);
  }
  
  console.log(`Lead: @${username}`);
  console.log(`  Status: ${leadContext.status}`);
  console.log(`  Stage: ${leadContext.conversation_stage || 'initial'}`);
  console.log(`  Engagement: ${leadContext.warmth} (Score: ${leadContext.engagement_score})`);
  // Bio removed
  if (leadContext.pain_points.length > 0) {
    console.log(`  Pain points: ${leadContext.pain_points.join(', ')}`);
  }
  console.log('');
  
  // Get conversation history
  let conversationHistory = await getConversationHistory(username);
  
  // If user provided a new message, add it
  if (options.message) {
    console.log('New message from prospect:');
    console.log(`  "${options.message}"\n`);
    
    // Save to DB
    await addMessage(username, 'user', options.message, null, accountId);
    
    // Add to history
    conversationHistory.push({
      role: 'user',
      text: options.message
    });
  }
  
  // If no conversation and no new message, prompt for one
  if (conversationHistory.length === 0) {
    console.log('No conversation history found.');
    console.log('Use --message "their message" to add the prospect\'s message.\n');
    throw new Error('No messages to respond to');
  }
  
  // Display conversation history
  console.log('--- Conversation History ---');
  conversationHistory.forEach((msg, i) => {
    const role = msg.role === 'user' ? 'PROSPECT' : 'YOU';
    const text = msg.text.length > 100 ? msg.text.substring(0, 100) + '...' : msg.text;
    console.log(`[${i + 1}] ${role}: ${text}`);
  });
  console.log('---\n');
  
  // Ensure last message is from user
  if (conversationHistory[conversationHistory.length - 1].role !== 'user') {
    throw new Error('Last message must be from the prospect. Use --message to add their reply.');
  }
  
  return { conversationHistory, leadContext };
}

/**
 * Handle interactive mode
 */
async function handleInteractiveMode() {
  console.log('Interactive mode\n');
  console.log('Enter the prospect\'s message (press Enter twice when done):\n');
  
  const userMessage = await readMultilineInput();
  
  console.log('\nMessage received\n');
  
  return [
    {
      role: 'user',
      text: userMessage.trim()
    }
  ];
}

/**
 * Handle file mode
 */
async function handleFileMode(conversationFile) {
  try {
    const conversationData = await readFile(conversationFile, 'utf-8');
    return JSON.parse(conversationData);
  } catch (error) {
    console.error(`Error reading conversation file: ${error.message}`);
    console.error('\nUsage:');
    console.error('  1. Create conversation_history.json with format:');
    console.error('     [{"role":"user","text":"..."},{"role":"assistant","text":"..."}]');
    console.error('  2. Run: node bin/run.js -c conversation_history.json\n');
    console.error('Or use --interactive mode to paste the message directly.');
    console.error('Or use --username to load from database.\n');
    process.exit(1);
  }
}

/**
 * Handle list mode - show active conversations
 */
async function handleListMode(accountId) {
  console.log('Active Conversations:\n');
  
  await initDB();
  const conversations = await getActiveConversations(accountId);
  
  if (conversations.length === 0) {
    console.log('No active conversations found.\n');
    console.log('Start by using the Outreach agent to send first messages.\n');
    return;
  }
  
  for (const lead of conversations) {
    const summary = await getConversationSummary(lead.username);
    
    console.log(`@${lead.username}`);
    console.log(`  Status: ${lead.status} | Stage: ${lead.conversation_stage || 'initial'}`);
    console.log(`  Messages: ${summary.message_count} | Last: ${lead.last_message_at || 'N/A'}`);
    if (summary.last_message) {
      const lastText = summary.last_message.text.substring(0, 60);
      console.log(`  Last message (${summary.last_message.role}): "${lastText}..."`);
    }
    console.log('');
  }
  
  console.log('To respond to a conversation:');
  console.log('  node bin/run.js --username <username> --message "their reply"\n');
}

/**
 * Display the generated response
 */
function displayResponse(response, leadContext) {
  console.log('='.repeat(60));
  console.log('SUGGESTED RESPONSE:\n');
  console.log(response.next_message);
  console.log('\n' + '='.repeat(60));
  
  console.log(`\nStage: ${response.conversation_stage}`);
  console.log(`Type: ${response.message_type}`);
  console.log(`\nReasoning:\n${response.reasoning}\n`);

  if (response.alternative_approaches && response.alternative_approaches.length > 0) {
    console.log('Alternative approaches:');
    response.alternative_approaches.forEach((alt, i) => {
      console.log(`  ${i + 1}. ${alt}`);
    });
    console.log('');
  }

  if (response.next_steps && response.next_steps.length > 0) {
    console.log('Suggested next steps:');
    response.next_steps.forEach((step, i) => {
      console.log(`  ${i + 1}. ${step}`);
    });
    console.log('');
  }
  
  // Show lead context tips if available
  if (leadContext) {
    console.log('--- Lead Context Tips ---');
    if (leadContext.bio) {
      console.log(`Bio mentions: ${leadContext.bio.substring(0, 80)}...`);
    }
    if (leadContext.pain_points && leadContext.pain_points.length > 0) {
      console.log(`Known pain points: ${leadContext.pain_points.join(', ')}`);
    }
    if (leadContext.original_comments && leadContext.original_comments.length > 0) {
      console.log(`Their original comment: "${leadContext.original_comments[0].text.substring(0, 60)}..."`);
    }
    console.log('');
  }
}

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
