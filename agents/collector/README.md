# Instagram Collector Agent

**Part of the Instagram Lead Engine**

Multi-mode agent for discovering and scraping Instagram posts and comments from hashtags and competitor profiles. Generates an Excel CRM with engagement scoring.

## 🚀 Quick Start

### 1. Installation

```bash
cd agents/collector
npm install
npx playwright install chromium
```

### 2. Configure Auto-Login (Recommended)

```bash
./setup-autologin.sh
```

This will:
- Prompt for Instagram username/password
- Save credentials to `.env` securely
- Handle special characters automatically

**Manual configuration**: Copy `.env.example` to `.env` and edit:
```bash
INSTAGRAM_USERNAME=your_username
INSTAGRAM_PASSWORD="your_password"  # Use quotes for special characters
```

See `SPECIAL_CHARS_GUIDE.md` if your password contains `"`, `'`, or `\`.

### 3. Run Your First Scrape

```bash
npm run scrape -- --hashtags marketing entrepreneurship --target-prospects 50
```

### 4. View Results

```bash
./open-crm.sh
```

Opens `output/instagram_prospects.xlsx` with 3 tabs:
- **Prospects**: Sorted by engagement score (HIGH/MEDIUM/LOW)
- **Historique**: All comments chronologically
- **Analytics**: Summary statistics

---

## 🎯 Features

- **Hashtag Discovery**: Find posts from specific hashtags
- **Profile Discovery**: Scrape posts from competitor profiles  
- **Comment Extraction**: Collect comments with user metadata
- **Engagement Scoring**: 50-point algorithm (see `ENGAGEMENT_SCORING.md`)
- **Excel CRM**: Automated prospect classification
- **Auto-Login**: Handles Instagram cookies/popups automatically
- **Modular Modes**: Run discovery only, scraping only, or both
- **Safety First**: Randomized delays, challenge detection
- **ToS Compliant**: Stops on rate limits, manual verification support

## 🎯 Usage

### NPM Scripts (Recommended)

```bash
# Scrape hashtags
npm run scrape -- --hashtags marketing business --target-prospects 50

# Scrape competitor profiles
npm run scrape -- --profiles https://instagram.com/competitor1 --target-prospects 30

# Combine both
npm run scrape -- --hashtags startup --profiles https://instagram.com/ycombinator --target-prospects 100

# Discovery only (no comment scraping)
npm run scrape -- --mode only-discover --hashtags fitness --max-posts 50

# Scrape previously discovered posts
npm run scrape -- --mode scrape-comments --target-prospects 50
```

### Direct CLI Usage

```bash
# Full syntax
node bin/run.js --mode both \
  --hashtags fitness transformation \
  --profiles competitor_coach \
  --max-posts 25 \
  --target-prospects 50
```

### CLI Options

```
Options:
  -m, --mode <mode>              Mode: hashtags|profiles|both|only-discover|scrape-comments (default: "both")
  -t, --hashtags <tags...>       Hashtags to scrape (space-separated)
  -p, --profiles <urls...>       Competitor profile URLs or usernames (space-separated)
  --max-posts <number>           Maximum posts per source (default: "50")
  --max-comments <number>        Maximum comments per post (default: "100")
  -o, --output <dir>             Output directory (default: "./output")
  --headless                     Run in headless mode (NOT RECOMMENDED)
  --help                         Display help
```

## 📊 Output Files

All files are saved to `output/` directory.

### `instagram_prospects.xlsx` (Main CRM)

Excel workbook with 3 tabs:

**1. Prospects Tab**
- Sorted by engagement score (50-point algorithm)
- Columns: Username, Profile URL, Comment, Score, Engagement Level, Comment Date, Post URL
- Classification: HIGH (35+), MEDIUM (20-34), LOW (0-19)

**2. Historique Tab**
- All comments chronologically
- Full conversation context

**3. Analytics Tab**
- Total prospects count
- Average engagement score
- Distribution by engagement level
- Top hashtags/sources

See `ENGAGEMENT_SCORING.md` for scoring algorithm details.

### `comments.csv`

Raw comments data:
```csv
post_url,username,profile_url,comment_text,comment_date,followers_estimate
https://instagram.com/p/ABC123/,sarah_fitness23,https://instagram.com/sarah_fitness23/,This is what I needed!,2024-01-14T19:00:00.000Z,
```

### `posts.csv`

Discovered posts metadata:
```csv
source_type,source_name,post_url,post_date,likes,comments_count,caption_excerpt
hashtag,fitness,https://www.instagram.com/p/ABC123/,2024-01-14T18:30:00.000Z,1234,87,Loving this new fitness journey...
```

### `tracking.json`

Internal tracking file to avoid re-scraping already processed posts.

### `context/*.json`

Individual JSON files per post with full metadata (for future analysis).

## 🔒 Safety & Compliance

### Manual Login Required

The agent opens a browser window where you **must manually log in** to Instagram. This ensures:

- ✅ You control your credentials (never stored)
- ✅ You complete 2FA/security checks yourself
- ✅ No automated login that violates ToS

### Anti-Detection Features

- **Headful browser only** (headless mode strongly discouraged)
- **Randomized delays** (3-7 seconds between actions)
- **Challenge detection** (stops if Instagram shows verification)
- **Rate limit respect** (pauses on detection)
- **Human-like scrolling** (gradual, not instant)

### Platform ToS Warning

⚠️ **IMPORTANT**: This agent is for **educational and research purposes**. 

- DO NOT use for spam or unsolicited DMs
- DO NOT scrape excessive data
- DO NOT automate account actions beyond what's shown here
- Always respect Instagram's Terms of Service and Community Guidelines

## 🐳 Docker Usage

```bash
# Build image
docker build -t collector-agent .

# Run with volume mount for output
docker run -v $(pwd)/output:/app/output collector-agent \
  --mode hashtags \
  --hashtags fitness \
  --max-posts 30
```

**Note**: Docker mode still requires X11 forwarding for headful browser on Linux/Mac.

## 🧪 Testing

```bash
npm test
```

## 🛠️ Troubleshooting

### Cookie Popup Not Closing

Instagram changed their cookie popup in Nov 2024 to "Allow all cookies".

**Quick test:**
```bash
node test-cookie-popup.js
```

**If it fails:**
```bash
# Clear Playwright cache
rm -rf ~/Library/Caches/ms-playwright
npx playwright install chromium

# Read full debug guide
cat DEBUG_COOKIE_POPUP.md
```

The system now handles 8+ cookie popup variants automatically (see `COOKIE_POPUP_FIX.md`).

### "Login verification failed"

**If using auto-login:**
```bash
# Test credentials parsing
node test-env-parsing.js

# Reconfigure if needed
./setup-autologin.sh
```

**If using manual login:**
Ensure you've logged in completely and see your Instagram feed before pressing Enter.

### "Challenge detected"

Instagram flagged suspicious activity. Wait 24-48 hours, use a different account, or reduce scraping frequency.

### Password with Special Characters

If your password contains `"`, `'`, or `\`, read `SPECIAL_CHARS_GUIDE.md` or run:
```bash
./setup-autologin.sh  # Handles escaping automatically
```

### Empty Excel File

If Excel was generated but has old/wrong data:
```bash
node regenerate-crm.js
```

This regenerates the Excel from existing CSV files.

### Engagement Scores Wrong

```bash
node test-engagement.js
```

See `ENGAGEMENT_SCORING.md` for algorithm details.

### Browser Won't Open

```bash
npx playwright install --force chromium
```

### Selectors Not Finding Elements

Instagram may have updated their UI. Check `prompts/selector_notes.md` and update selectors in `src/config.js`.

## 📁 Project Structure

```
collector/
├── bin/run.js              # CLI entry point
├── src/
│   ├── index.js            # Main orchestrator
│   ├── discover.js         # Hashtag & profile discovery
│   ├── scrape_post.js      # Comment scraping
│   ├── utils.js            # File I/O, delays, detection
│   └── config.js           # Configuration constants
├── prompts/
│   └── selector_notes.md   # Selector documentation & update guide
├── samples/                # Example output files
├── tests/                  # Unit tests
├── output/                 # Generated output (gitignored)
├── Dockerfile
├── .env.example
└── README.md
```

## 🧪 Testing

### Run All Tests
```bash
./test-all.sh
```

### Individual Tests
```bash
node test-cookie-popup.js    # Test Instagram cookie popup handling
node test-env-parsing.js     # Test .env credentials parsing
node test-engagement.js      # Test engagement scoring algorithm
node test-crm-enhanced.js    # Test Excel CRM generation
```

---

## 📚 Additional Documentation

| File | Description |
|------|-------------|
| `AUTOLOGIN_SETUP.md` | Detailed auto-login configuration guide |
| `COOKIE_POPUP_FIX.md` | Technical details of cookie popup fix (Nov 2024) |
| `DEBUG_COOKIE_POPUP.md` | Complete troubleshooting guide for cookie issues |
| `ENGAGEMENT_SCORING.md` | 50-point engagement algorithm documentation |
| `SPECIAL_CHARS_GUIDE.md` | How to handle special characters in passwords |

---

## 🔄 Integration with Other Agents

After collecting data with this agent:

1. Open CRM: `./open-crm.sh`
2. Sort by Score (descending)
3. Manually reach out to HIGH engagement prospects
4. Use **DMRESPONDER AGENT** to generate contextual follow-up messages

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please:

1. Keep code modular and documented
2. Update `selector_notes.md` if changing selectors
3. Add tests for new functionality
4. Follow existing code style (ESM, async/await)

## ⚖️ Disclaimer

This tool is provided as-is for educational purposes. Users are responsible for complying with Instagram's Terms of Service and all applicable laws. The authors assume no liability for misuse.
