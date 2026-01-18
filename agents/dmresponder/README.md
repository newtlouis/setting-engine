# Instagram DM Responder Agent

**Part of the Instagram Lead Engine**

Context-aware conversation AI that generates personalized follow-up messages for Instagram DM conversations.

## Features

- **Conversation State Machine**: Automatically detects conversation stage
- **Intent Detection**: Identifies pain points, objections, and buying signals
- **Empathy-First Messaging**: Human, relatable tone
- **Qualification Pipeline**: Strategic questions to assess fit
- **Objection Handling**: Pre-built frameworks for common concerns
- **CTA Generation**: Natural call-to-action suggestions
- **Human-In-Loop**: NEVER sends automated messages—suggestions only
- **SQLite Integration**: Load conversations and lead context from shared database

## ⚠️ CRITICAL SAFETY REQUIREMENTS

**This agent is for SUGGESTIONS ONLY:**

- ✅ Use AFTER you've sent the first manual DM and prospect has replied
- ✅ Always review and personalize generated responses
- ✅ NEVER automate sending without human approval
- ❌ DO NOT use for cold outreach automation
- ❌ DO NOT send messages without reading them first

## 📦 Installation

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
cd agents/dmresponder
npm install
```

### Configuration

```bash
cp .env.example .env
# Edit .env as needed
```

## Usage

### Database Mode (Recommended)

Load conversation from SQLite database by username:

```bash
# List active conversations
node bin/run.js --list

# Respond to a lead (add their latest message)
node bin/run.js --username johndoe --message "their reply here"

# Save response to database
node bin/run.js --username johndoe --message "their reply" --save
```

### Interactive Mode

```bash
node bin/run.js --interactive
```

Paste the prospect's message, press Enter twice, and get a suggested response.

### File Mode

**1. Create conversation_history.json:**

```json
[
  {
    "role": "assistant",
    "text": "Hey! I saw your comment. Are you dealing with something similar?"
  },
  {
    "role": "user",
    "text": "Yeah, I've been struggling with this for months and nothing works."
  }
]
```

**2. Run the agent:**

```bash
node bin/run.js -c conversation_history.json -o response.json
```

**3. Review the generated response:**

```bash
cat response.json
```

### With Lead Context (Optional)

```bash
node bin/run.js \
  -c conversation_history.json \
  -l lead_context.json \
  -o response.json
```

Lead context enhances responses with prospector data.

### CLI Options

```
Options:
  -c, --conversation <file>   Path to conversation_history.json (default: "conversation_history.json")
  -l, --lead <file>           Path to lead_context.json (optional)
  -b, --business <file>       Path to business_context.json (optional)
  -o, --output <file>         Output file for response (default: "response.json")
  --interactive               Interactive mode: prompt for user message
  --help                      Display help
```

- Suggestions are saved as JSON files under `output/suggestions/` (configurable via `--output-dir`).
- Each processed thread updates the `dm_threads` table with the latest status plus metadata (last check, last suggestion path), so other agents or dashboards can read the same source of truth.

---

### 4b. Follower Watcher (New Follower Outreach) ⭐ NOUVEAU

Monitors new Instagram followers and initiates personalized outreach messages.

```bash
# Scan today's new followers
npm run followers -- --profile my_account

# Scan this week's followers (includes scrolling)
npm run followers -- --profile my_account --track-week
```

- **Database Integration**: Automatically creates leads in the database with `outreach` status.
- **AI Personalization**: Extracts names from bios and generates friendly welcomes.
- **Configuration**: Uses `follower_template` from `melanie.config.js`.

---

### 4c. Follow-up Agent ⭐ NOUVEAU

Identifies leads who haven't replied to your last message and sends strategic follow-ups.

```bash
npm run followup -- --profile my_account
```

- **Timing**: Defaults to 48h after the last message.
- **Context-Aware**: Generates follow-ups based on the conversation stage.
- **Limit**: Set `--limit` to control daily outreach volume.

## 📊 Input Format

### conversation_history.json

```json
[
  {
    "role": "assistant",
    "text": "Your previous message"
  },
  {
    "role": "user",
    "text": "Prospect's reply you want to respond to"
  }
]
```

**Rules:**
- Array of message objects
- Each message has `role` (`user` or `assistant`) and `text`
- Latest message MUST be from `user` (the prospect)

### lead_context.json (Optional)

```json
{
  "username": "sarah_fitness23",
  "warmth": "warm",
  "score": 85,
  "pain_points": ["consistency", "motivation"],
  "goals": ["get in shape", "build habits"],
  "best_approach": "Empathy-first, address past failures"
}
```

Comes from the **Prospector Agent** output.

### business_context.json (Optional)

```json
{
  "service": "fitness coaching",
  "niche": "transformation",
  "timeline": "90 days",
  "format": "1-on-1"
}
```

Personalizes responses with your business details.

## 📤 Output Format

### response.json

```json
{
  "next_message": "I hear you. That pattern of starting and stopping is so common. Can I ask—how important is solving this in the next few months?",
  "conversation_stage": "qualification",
  "message_type": "qualification",
  "reasoning": "User expressed frustration with past failures. Moving to qualification to assess timeline and commitment.",
  "alternative_approaches": [
    "Share a relevant success story",
    "Ask about their biggest obstacle"
  ],
  "next_steps": [
    "Listen for buying signals",
    "If qualified, transition to value demo"
  ]
}
```

## 🧠 Conversation Stages

The agent automatically detects these stages:

1. **initial_rapport**: First 1-2 messages, building connection
2. **empathy_building**: Acknowledging pain, validating feelings
3. **qualification**: Assessing fit (timeline, budget, commitment)
4. **objection_handling**: Addressing concerns (price, time, skepticism)
5. **value_demonstration**: Showing how you can help
6. **call_to_action**: Suggesting next step (call, meeting)
7. **scheduling**: Booking the call
8. **closed_won**: Deal closed
9. **closed_lost**: Not a fit

## 💬 Message Types

- **empathy**: Validating feelings, building rapport
- **qualification**: Questions to assess fit
- **rapport**: General relationship-building
- **objection_response**: Handling concerns
- **value_prop**: Demonstrating your solution
- **call_to_action**: Suggesting next step
- **scheduling**: Booking logistics

## 🎭 Example Scenarios

### Scenario 1: Prospect Expresses Pain

**Input:**
```json
[
  {
    "role": "user",
    "text": "I'm so frustrated. I've tried everything and nothing works."
  }
]
```

**Output:**
```
Stage: empathy_building
Type: empathy

Message: "I hear you. Feeling like you've tried everything and still not seeing results is incredibly frustrating. You're not alone in this. Can I ask you something that might help me understand better—what would it mean for you if you could finally solve this?"
```

### Scenario 2: Prospect Shows Interest

**Input:**
```json
[
  {
    "role": "user",
    "text": "Yeah, I'm interested. How does your program work?"
  }
]
```

**Output:**
```
Stage: qualification
Type: qualification

Message: "That's a great question. Before I dive into the details, can I ask—how soon are you looking to make a change? Is this something you want to tackle in the next few weeks, or are you still exploring options?"
```

### Scenario 3: Price Objection

**Input:**
```json
[
  {
    "role": "user",
    "text": "That sounds good but it's too expensive for me right now."
  }
]
```

**Output:**
```
Stage: objection_handling
Type: objection_response

Message: "I totally understand. Most people I work with felt the same way at first. What they realized is that the cost of staying stuck is way higher than the investment. Can I ask—what's it costing you to not fix this right now?"
```

## 🧪 Testing

```bash
npm test
```

## 🛠️ Troubleshooting

### "Latest message must be from user"

**Solution**: Ensure the last message in conversation_history.json has `"role": "user"`.

### Responses feel generic

**Solution**: Add lead_context.json and business_context.json for better personalization.

### Response too long

**Solution**: Messages are auto-truncated to 500 characters (Instagram best practice).

## 📁 Project Structure

```
dmresponder/
├── bin/run.js              # CLI entry point
├── src/
│   ├── engine.js           # Main response generator
│   ├── state_machine.js    # Stage detection & intent analysis
│   ├── templates.js        # Message templates by type
│   ├── utils.js            # Validation & sanitization
│   └── config.js           # Configuration constants
├── sample_inputs/          # Example input files
├── sample_outputs/         # Example output files
├── tests/                  # Unit tests
├── Dockerfile
├── .env.example
└── README.md
```

## 🔄 Workflow Integration

**Typical workflow:**

1. Use **Collector Agent** to scrape comments
2. Use **Prospector Agent** to qualify leads
3. Use **Lead Analyzer Agent** to identify top prospects
4. **Manually send first DM** on Instagram (NEVER automate this!)
5. When prospect replies, copy their message
6. Use **DM Responder Agent** to generate suggested reply
7. Review, personalize, and manually send

## 💡 Best Practices

### DO:
- ✅ Review every generated response
- ✅ Personalize with specific details from the conversation
- ✅ Use as inspiration, not a script
- ✅ Maintain your authentic voice
- ✅ Build genuine relationships

### DON'T:
- ❌ Copy-paste without reading
- ❌ Automate sending messages
- ❌ Use for cold outreach spam
- ❌ Send generic templated messages
- ❌ Ignore context and nuance

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please:

1. Keep responses human and empathetic
2. Test new templates with real conversations
3. Add tests for new features
4. Follow existing code style

## ⚖️ Disclaimer

This tool generates SUGGESTIONS only. Users are responsible for:
- Reviewing all generated content
- Complying with Instagram's Terms of Service
- Building authentic relationships
- Never automating DM sending

The authors assume no liability for misuse or policy violations.
