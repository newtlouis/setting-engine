# Instagram Collector Agent

**Part of the Instagram Lead Engine**

Multi-mode agent for discovering and scraping Instagram posts and comments from hashtags and competitor profiles.

## 🚀 Features

- **Hashtag Discovery**: Find posts from specific hashtags
- **Profile Discovery**: Scrape posts from competitor profiles  
- **Comment Extraction**: Collect comments with metadata
- **Modular Modes**: Run discovery only, scraping only, or both
- **Safety First**: Manual login, headful browser, randomized delays
- **ToS Compliant**: Stops on challenge detection, respects rate limits

## 📦 Installation

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Setup

```bash
cd agents/collector
npm install
npx playwright install chromium
```

### Configuration

```bash
cp .env.example .env
# Edit .env as needed
```

## 🎯 Usage

### Basic Examples

**Discover posts from hashtags:**
```bash
node bin/run.js --mode hashtags --hashtags fitness motivation wellness --max-posts 30
```

**Discover posts from competitor profiles:**
```bash
node bin/run.js --mode profiles --profiles competitor_coach fitness_brand --max-posts 50
```

**Discover from both hashtags and profiles:**
```bash
node bin/run.js --mode both \
  --hashtags fitness transformation \
  --profiles competitor_coach \
  --max-posts 25
```

**Discovery only (no comment scraping):**
```bash
node bin/run.js --mode only-discover --hashtags fitness --max-posts 20
```

**Scrape comments from previously discovered posts:**
```bash
node bin/run.js --mode scrape-comments --max-comments 100
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

### `posts.csv`

Columns: `source_type`, `source_name`, `post_url`, `post_date`, `likes`, `comments_count`, `caption_excerpt`

```csv
source_type,source_name,post_url,post_date,likes,comments_count,caption_excerpt
hashtag,fitness,https://www.instagram.com/p/ABC123/,2024-01-14T18:30:00.000Z,1234,87,Loving this new fitness journey...
```

### `comments.csv`

Columns: `post_url`, `username`, `profile_url`, `comment_text`, `comment_date`, `followers_estimate`

```csv
post_url,username,profile_url,comment_text,comment_date,followers_estimate
https://instagram.com/p/ABC123/,sarah_fitness23,https://instagram.com/sarah_fitness23/,This is what I needed!,2024-01-14T19:00:00.000Z,
```

### `context/*.json`

Individual JSON files per post with full metadata:

```json
{
  "post_url": "https://www.instagram.com/p/ABC123/",
  "scraped_at": "2024-01-15T14:23:45.678Z",
  "caption": "Full caption text...",
  "likes": "1,234 likes",
  "comments_count": "87"
}
```

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

### "Login verification failed"

**Solution**: Ensure you've logged in completely and see your Instagram feed before pressing Enter.

### "Challenge detected"

**Solution**: Instagram has flagged suspicious activity. Wait 24-48 hours, use a different account, or reduce scraping frequency.

### Selectors not finding elements

**Solution**: Instagram may have updated their UI. Check `prompts/selector_notes.md` and update selectors in `src/config.js`.

### Browser won't open

**Solution**: Reinstall Playwright browsers:
```bash
npx playwright install --force chromium
```

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

## 🔄 Next Steps

After collecting data with this agent:

1. Use **PROSPECTOR AGENT** to classify leads from `comments.csv`
2. Use **LEAD ANALYZER AGENT** to identify top prospects
3. Use **DMRESPONDER AGENT** to generate contextual replies (after manual outreach)

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
