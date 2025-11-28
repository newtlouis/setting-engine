# Instagram Outreach Agent

Send personalized first DMs to qualified leads from your database.

## CRITICAL SAFETY NOTES

**This tool is designed with safety in mind:**
- Default mode is **PREVIEW** (no messages sent)
- Requires **manual Instagram login** (no credential storage)
- Enforces **rate limits** to avoid account restrictions
- All messages should be **reviewed before sending**

**Never automate outreach at scale.** Instagram actively detects and restricts accounts that send too many DMs.

## Features

- Select leads from SQLite database based on engagement score
- Generate personalized first messages using templates
- Preview messages before sending
- Send DMs via Playwright browser automation
- Track sent messages in the database
- Rate limiting and block detection

## Installation

```bash
cd agents/outreach
npm install
npx playwright install chromium
```

## Configuration

```bash
cp .env.example .env
# Edit .env as needed
```

## Usage

### 1. Check Status

See your lead pipeline:

```bash
node bin/run.js --mode status
```

### 2. Preview Messages

Preview what messages would be sent (no actual sending):

```bash
node bin/run.js --mode preview --limit 5
```

### 3. Dry Run

Test the full flow (types messages but doesn't send):

```bash
node bin/run.js --mode send --limit 3
```

### 4. Live Send (CAREFUL!)

Actually send messages:

```bash
node bin/run.js --mode send --limit 3 --live
```

## CLI Options

```
Options:
  -m, --mode <mode>           Operation mode: preview, send, status (default: "preview")
  -l, --limit <number>        Number of leads to process (default: 5)
  -n, --niche <niche>         Your niche/industry for templates (default: "fitness")
  -t, --topic <topic>         Topic to reference in messages (default: "their goals")
  --live                      Actually send messages (dangerous!)
  --browser-data <path>       Path to browser data directory (default: "./browser-data")
  --min-engagement <score>    Minimum engagement score (default: 10)
  --min-followers <count>     Minimum follower count (default: 100)
  --max-followers <count>     Maximum follower count (default: 50000)
  -h, --help                  Display help
```

## How It Works

### 1. Lead Selection

Leads are selected from the database based on:
- Status = "new" (not yet contacted)
- Engagement score above threshold
- Follower count within range
- Not private (optional)

Ordered by:
1. Warmth (hot > warm > cold)
2. Engagement score (highest first)

### 2. Message Generation

Messages are generated using templates based on:
- Lead's comment history (pain signals, questions)
- Engagement level
- Profile data

Template categories:
- **Pain-based**: For leads who expressed frustration
- **Question-based**: For leads who asked questions
- **Engagement-based**: For highly active leads
- **Generic**: Fallback templates

### 3. Sending Flow

For each lead:
1. Navigate to their profile
2. Click "Message" button
3. Type message with human-like delays
4. Send (or skip in dry-run mode)
5. Wait random delay before next

### 4. Database Updates

After successful send:
- Lead status → "contacted"
- Message saved to `conversations` table
- `first_message_sent_at` timestamp set

## Rate Limits

Default settings (customize in .env):
- **Minimum 1 minute** between DMs
- **Maximum 3 minutes** between DMs
- **Max 10 DMs** per session
- **Max 20 DMs** per day
- **4 hour cooldown** between sessions

## Customizing Templates

Edit `src/templates.js` to add your own templates:

```javascript
export const TEMPLATES = {
  pain_based: [
    {
      id: 'my_custom_template',
      template: `Hey {{firstName}}! I noticed your comment about {{topic}}...`,
      variables: ['firstName', 'topic'],
      tone: 'empathetic',
      best_for: ['expressing_pain']
    }
  ]
};
```

Available variables:
- `{{firstName}}` - Lead's first name
- `{{topic}}` - Topic from options
- `{{niche}}` - Niche from options
- `{{painPoint}}` - Extracted from comments
- `{{creatorName}}` - Creator name if known

## Workflow Integration

Typical workflow:

1. **Collect** leads with Collector agent
2. **Scrape profiles** for follower counts
3. **Review** eligible leads with `--mode preview`
4. **Send** DMs with `--mode send --live`
5. **Track** responses with DM Responder agent

## Database Schema

This agent uses the shared SQLite database with:

**Leads table updates:**
- `status`: new → contacted → replied
- `first_message_sent_at`: timestamp
- `conversation_stage`: initial

**Conversations table:**
- Stores all sent/received messages
- Links to lead via `lead_id`

## Troubleshooting

### "No eligible leads found"

- Check engagement score threshold
- Verify leads exist with `--mode status`
- Lower `--min-engagement` if needed

### "message_button_not_found"

- Profile may be private
- User may have DM requests disabled
- Instagram UI may have changed (update selectors)

### "challenge_detected" or "rate_limit_detected"

- STOP immediately
- Wait at least 24 hours
- Reduce sending volume
- Use different IP if possible

### Browser doesn't open

- Ensure Playwright is installed: `npx playwright install chromium`
- Check `HEADLESS=false` in .env

## Security Notes

- **No credentials stored** - manual login required
- **Browser data persisted** - session stays logged in
- **Rate limits enforced** - can't be disabled
- **Preview by default** - must explicitly enable sending

## Disclaimer

This tool is for legitimate outreach only. Users are responsible for:
- Complying with Instagram's Terms of Service
- Respecting rate limits
- Sending relevant, non-spammy messages
- Building authentic relationships

The authors assume no liability for account restrictions or misuse.
