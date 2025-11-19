# Instagram Lead Engine

**A complete multi-agent system for ethical Instagram lead generation and relationship building.**

## 🎯 Overview

The Instagram Lead Engine is a production-ready, modular system of independent agents designed to help coaches, consultants, and service providers find and connect with qualified prospects on Instagram.

Each agent is fully independent and can be sold/used separately.

## 🏗️ Architecture

This system contains **5 independent agents**:

### 1. **Collector Agent** (Data Collection)
Discovers posts and scrapes comments from hashtags and competitor profiles.

- ✅ Hashtag discovery
- ✅ Competitor profile discovery
- ✅ Comment scraping with metadata
- ✅ Manual login (ToS compliant)
- ✅ Headful browser with anti-detection

**Output**: `posts.csv`, `comments.csv`, context JSON files

---

### 2. **Prospector Agent** (Lead Qualification)
Classifies commenters based on their likelihood to convert.

- ✅ Analyzes comment sentiment and intent
- ✅ Extracts pain points, goals, and motivations
- ✅ Classifies as: warm, cold, or irrelevant
- ✅ Scores leads 0-100

**Input**: `comments.csv`  
**Output**: `leads.json`

---

### 3. **Lead Analyzer Agent** (Strategic Analysis)
Identifies your best prospects and creates outreach strategies.

- ✅ Generates customer persona summaries
- ✅ Identifies 3-5 top prospects
- ✅ Creates pitch angles per prospect
- ✅ Prepares message frameworks

**Input**: `leads.json`  
**Output**: `messages.json`

---

### 4. **DM Responder Agent** (Conversation AI)
Generates contextual follow-up messages for Instagram DMs.

- ✅ Conversation state machine
- ✅ Empathy-first messaging
- ✅ Qualification questions
- ✅ Objection handling
- ✅ CTA generation

**Input**: `conversation_history.json`  
**Output**: `response.json`

⚠️ **IMPORTANT**: Only use AFTER you've manually sent the first DM and prospect has replied.

---

### 5. **Message Generator Agent** (Content Creation)
Generates Instagram posts, reels scripts, hooks, and carousels.

- ✅ 30-60 post ideas based on niche
- ✅ Reels scripts
- ✅ Hooks and pattern interrupts
- ✅ Carousel outlines

**Input**: Niche, audience pain points  
**Output**: `content_ideas.json`

---

## 📦 Installation

### Prerequisites

- Node.js 18+
- npm or yarn

### Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd instagram-lead-engine

# Install Collector Agent
cd agents/collector
npm install
npx playwright install chromium

# Install DM Responder Agent
cd ../dmresponder
npm install

# Repeat for other agents as needed
```

## 🚀 Usage

### Step 1: Collect Data (Collector Agent)

```bash
cd agents/collector
node bin/run.js --mode both \
  --hashtags fitness transformation \
  --profiles competitor_coach \
  --max-posts 50
```

**Output**: `output/posts.csv`, `output/comments.csv`

---

### Step 2: Qualify Leads (Prospector Agent)

```bash
cd agents/prospector
node bin/run.js \
  --input ../collector/output/comments.csv \
  --output leads.json
```

**Output**: `leads.json` with warm/cold/irrelevant classifications

---

### Step 3: Analyze Top Prospects (Lead Analyzer Agent)

```bash
cd agents/lead-analyzer
node bin/run.js \
  --input ../prospector/leads.json \
  --output messages.json
```

**Output**: `messages.json` with personalized outreach templates

---

### Step 4: Manual Outreach

**⚠️ CRITICAL: This step is MANUAL**

1. Review `messages.json`
2. Choose your top prospects
3. Manually send the first DM on Instagram
4. DO NOT automate this step

---

### Step 5: Follow-Up with DM Responder (After They Reply)

```bash
cd agents/dmresponder

# Interactive mode (paste their reply)
node bin/run.js --interactive

# Or file mode
node bin/run.js -c conversation_history.json -o response.json
```

**Output**: Suggested follow-up message (review before sending!)

---

## 📊 Data Flow

```
Instagram
    ↓
[Collector Agent]
    ↓
posts.csv + comments.csv
    ↓
[Prospector Agent]
    ↓
leads.json (warm/cold/irrelevant)
    ↓
[Lead Analyzer Agent]
    ↓
messages.json (personalized templates)
    ↓
[MANUAL OUTREACH]
    ↓
[Prospect replies]
    ↓
[DM Responder Agent]
    ↓
Suggested follow-up message
    ↓
[Review & send manually]
```

## 🔒 Safety & Compliance

### Manual Login Required

- All scraping requires manual Instagram login
- You complete 2FA/security checks yourself
- No stored credentials

### Anti-Detection

- Headful browser (not headless)
- Randomized delays (3-7 seconds)
- Stops on challenge detection
- Human-like scrolling

### No Automation of Outreach

- ❌ NEVER automate sending DMs
- ❌ NEVER automate first message
- ✅ ALWAYS review AI-generated responses
- ✅ ALWAYS personalize before sending

### Platform ToS

⚠️ **IMPORTANT**: This system is for educational and ethical use only.

- DO NOT use for spam or unsolicited mass DMs
- DO NOT scrape excessive data
- DO NOT violate Instagram's Terms of Service
- ALWAYS build genuine relationships

## 🧪 Testing

Each agent has its own test suite:

```bash
# Test Collector
cd agents/collector && npm test

# Test DM Responder
cd agents/dmresponder && npm test

# Repeat for other agents
```

## 📁 Project Structure

```
instagram-lead-engine/
├── agents/
│   ├── collector/           # Data collection agent
│   ├── prospector/          # Lead qualification agent
│   ├── lead-analyzer/       # Strategic analysis agent
│   ├── dmresponder/         # Conversation AI agent
│   └── message-generator/   # Content creation agent
├── schemas/                 # JSON schemas for data validation
├── shared/                  # Shared utilities and constants
├── AGENTS.md               # Detailed agent documentation
├── CHANGELOG.md            # Version history
└── README.md               # This file
```

## 📚 Documentation

- **[AGENTS.md](./AGENTS.md)**: Detailed documentation for each agent
- **[Collector README](./agents/collector/README.md)**: Collector agent guide
- **[DM Responder README](./agents/dmresponder/README.md)**: DM Responder agent guide
- Individual agent READMEs in each agent folder

## 🎓 Use Cases

### For Fitness Coaches

1. Collect comments from fitness hashtags
2. Identify people struggling with motivation
3. Send empathetic first message
4. Use DM Responder for qualification
5. Book discovery calls

### For Business Coaches

1. Scrape competitor coach profiles
2. Find entrepreneurs expressing pain points
3. Reach out with value-first message
4. Qualify with strategic questions
5. Close consultations

### For Course Creators

1. Find engaged audience in your niche
2. Analyze their goals and fears
3. Create targeted outreach
4. Nurture with DM conversation
5. Convert to course enrollment

## 💡 Best Practices

### DO:
- ✅ Build genuine relationships
- ✅ Provide value first
- ✅ Personalize every message
- ✅ Be patient and empathetic
- ✅ Respect people's time

### DON'T:
- ❌ Mass DM without context
- ❌ Copy-paste generic templates
- ❌ Automate sending messages
- ❌ Spam or harass people
- ❌ Violate platform policies

## 🛠️ Troubleshooting

### Common Issues

**1. Browser won't open (Collector)**
```bash
npx playwright install --force chromium
```

**2. Challenge detected**
- Wait 24-48 hours
- Use different account
- Reduce scraping frequency

**3. Generic responses (DM Responder)**
- Add lead context file
- Add business context file
- Personalize templates

**4. CSV/JSON format errors**
- Check schema files in `schemas/`
- Validate with example files in `samples/`

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions welcome! Please:

1. Follow existing code style (ESM, async/await)
2. Add tests for new features
3. Update documentation
4. Maintain modularity between agents

## ⚖️ Disclaimer

This system is provided for educational purposes. Users are responsible for:

- Complying with Instagram's Terms of Service
- Following applicable laws and regulations
- Building ethical, genuine relationships
- Never automating outreach without human review
- Respecting privacy and consent

The authors assume no liability for misuse, policy violations, or any damages arising from use of this system.

## 🌟 Support

- Report issues: [GitHub Issues]
- Documentation: [AGENTS.md](./AGENTS.md)
- Examples: Check `samples/` folders in each agent

---

**Built with ❤️ for ethical lead generation**
