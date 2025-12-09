# Instagram Lead Engine

**A complete multi-agent system for ethical Instagram lead generation and relationship building.**

## 🎯 Overview

The Instagram Lead Engine is a production-ready, modular system of independent agents designed to help coaches, consultants, and service providers find and connect with qualified prospects on Instagram.

It uses a **shared SQLite database** to track leads through the entire lifecycle: from discovery to initial outreach to conversation handling.

## 🏗️ Architecture

This system contains **3 core agents**:

### 1. **Collector Agent** (Data Collection)
Discovers posts and scrapes comments from hashtags and competitor profiles.
- ✅ Hashtag & profile discovery
- ✅ Comment scraping with metadata
- ✅ Engagement scoring & qualification
- ✅ **Output**: Saves qualified leads to SQLite database

### 2. **Outreach Agent** (First Contact)
Identifies top prospects and sends personalized first messages.
- ✅ Filters leads by engagement score
- ✅ Generates personalized messages based on context
- ✅ Handles manual/automated sending flow (preview mode available)
- ✅ **Output**: Updates lead status, logs sent messages

### 3. **DM Responder Agent** (Conversation AI)
Generates contextual follow-up messages for ongoing conversations.
- ✅ Analyzes conversation history
- ✅ Suggests empathetic, qualified responses
- ✅ Handles objections and value propositions
- ✅ **Output**: Suggests replies, tracks conversation state

---

## 🚀 Quick Start (5 Minutes)

### 1. Install & Setup

```bash
# Install dependencies for all agents
cd agents/collector && npm install
cd ../outreach && npm install
cd ../dmresponder && npm install

# Install browser (required for Collector/Outreach)
npx playwright install chromium
```

### 2. Configure Auto-Login

Run the setup script in the collector directory to securely store your credentials:

```bash
cd agents/collector
./setup-autologin.sh
```

### 3. Run Your First Scrape (Collector)

```bash
npm run scrape -- --hashtags fitness --target-prospects 20
```
*This will find posts, scrape comments, score prospects, and save them to the database.*

### 4. Send Initial DMs (Outreach)

```bash
cd ../outreach
# Preview messages first
node bin/run.js --mode preview --limit 5

# Send messages (opens browser for manual confirmation by default)
node bin/run.js --mode send --limit 5
```

### 5. Respond to Replies (DM Responder)

```bash
cd ../dmresponder
# Interactive mode to generate replies
node bin/run.js --interactive
```

---

## 📊 Data Flow (SQLite)

The system is built around a shared **SQLite database** located in `agents/collector/data/instagram.db` (by default).

```mermaid
graph TD
    A[Instagram] -->|Collector Agent| B[(SQLite DB)]
    B -->|Filter: High Engagement| C[Outreach Agent]
    C -->|Send DM| A
    A -->|Reply| D[DM Responder Agent]
    D -->|Suggestion| E[User Review]
    E -->|Send| A
```

1.  **Collector**: Ingests raw data -> `leads` table.
2.  **Outreach**: Reads `new` leads -> updates to `contacted` -> `conversations` table.
3.  **DM Responder**: Reads conversation history -> suggests next move.

---

## 🔒 Safety & Compliance

### Manual Login Required
- All scraping/sending requires manual Instagram login via the headful browser.
- Credentials are stored locally in `.env` only.

### Anti-Detection
- Headful browser (not headless)
- Randomized delays (3-7 seconds)
- Stops on challenge detection
- Human-like scrolling behavior

### Ethical Use
- ❌ **NEVER** spam or send unsolicited mass DMs.
- ❌ **NEVER** automate outreach without human review.
- ✅ **ALWAYS** personalize messages and provide value.

---

## 📁 Project Structure

```
instagram-lead-engine/
├── agents/
│   ├── collector/           # Discovery & Scoring (holds the DB)
│   ├── outreach/            # First Message & Sending
│   └── dmresponder/         # Conversation AI
├── shared/                  # Shared utilities (DB connection, validators)
├── AGENTS.md                # Detailed agent documentation
└── README.md                # This file
```

## 📚 Documentation

- **[AGENTS.md](./AGENTS.md)**: Detailed technical documentation for all agents.
- **[Collector README](./agents/collector/README.md)**
- **[Outreach README](./agents/outreach/README.md)**
- **[DM Responder README](./agents/dmresponder/README.md)**

---

## ⚖️ Disclaimer

This system is provided for **educational purposes only**. Users are responsible for complying with Instagram's Terms of Service and applicable laws. The authors assume no liability for misuse, account restrictions, or damages.

**Built with ❤️ for ethical lead generation**
