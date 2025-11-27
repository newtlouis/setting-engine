# 🚀 QUICK START - Instagram Lead Engine

## 📋 Overview

This is a simplified 3-step system for collecting Instagram leads:
1. **Scrape** - Collect comments from Instagram posts
2. **Save** - Append to permanent master database  
3. **Build** - Generate Excel file with all data

## 🛠️ Setup

```bash
# 1. Install dependencies
npm install

# 2. Create .env file with your Instagram credentials (optional for auto-login)
cp .env.example .env
# Edit .env and add your INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD
```

## 🎯 The 3-Step Workflow

### Step 1: Scrape Instagram Data
```bash
npm run scrape
```
- Opens browser and logs into Instagram
- Scrapes posts from hashtags/profiles
- Saves comments to `data/comments.csv`

### Step 2: Save to Permanent Storage
```bash
npm run save-comments
```
- Reads `data/comments.csv`
- Filters out duplicates
- Appends to `permanent-data/master_comments.csv`
- Your data is now permanently saved!

### Step 3: Build Excel Database
```bash
npm run build-final-db
```
- Reads from `permanent-data/master_comments.csv`
- Creates `data/instagram_final_database.xlsx` with:
  - Sheet 1: All Prospects (complete list)
  - Sheet 2: By Source (grouped by hashtag/profile)
  - Sheet 3: Statistics (summary metrics)

## 📁 File Structure

```
collector/
├── data/                      # Temporary working directory
│   ├── comments.csv          # Latest scraping session
│   └── instagram_final_database.xlsx  # Final Excel output
├── permanent-data/           # Permanent storage (never deleted)
│   └── master_comments.csv   # All prospects ever collected
```

## 💡 Important Notes

1. **Data Safety**: The `permanent-data/master_comments.csv` file contains ALL your historical data. Back it up regularly!

2. **No Duplicates**: The system automatically prevents duplicate entries based on username.

3. **Source Tracking**: Each prospect is tagged with its source (e.g., "hashtag:fitness", "profile:competitor").

4. **Manual Login**: If auto-login fails or you don't provide credentials, you can always login manually in the browser.

## 🔧 Troubleshooting

- **"No comments.csv found"**: Run `npm run scrape` first
- **"Master file is empty"**: Run `npm run save-comments` after scraping
- **Login issues**: Check your .env credentials or login manually
- **Missing dependencies**: Run `npm install`

## 📊 Example Usage

```bash
# Complete workflow for collecting fitness leads
npm run scrape        # Scrape #fitness hashtag
npm run save-comments # Save to permanent storage  
npm run build-final-db # Generate Excel report

# The Excel file is now ready at: data/instagram_final_database.xlsx
```

That's it! Simple, reliable, and your data is always safe in the master CSV. 🎉