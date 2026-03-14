#!/bin/bash
# PMAD Installation Script for Setting Engine
# Copies slash commands to .claude/commands/ and configures the project.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Installing PMAD for Setting Engine..."

# 1. Create .claude/commands/ if it doesn't exist
mkdir -p "$PROJECT_ROOT/.claude/commands"

# 2. Copy slash commands
cp "$SCRIPT_DIR/commands/pmad.md" "$PROJECT_ROOT/.claude/commands/pmad.md"
cp "$SCRIPT_DIR/commands/pmad-quick.md" "$PROJECT_ROOT/.claude/commands/pmad-quick.md"
cp "$SCRIPT_DIR/commands/pmad-full.md" "$PROJECT_ROOT/.claude/commands/pmad-full.md"

echo "  Copied slash commands to .claude/commands/"

# 3. Add .pmad/ to .gitignore if not already present
if ! grep -q "^\.pmad/" "$PROJECT_ROOT/.gitignore" 2>/dev/null; then
  echo "" >> "$PROJECT_ROOT/.gitignore"
  echo "# PMAD session artifacts" >> "$PROJECT_ROOT/.gitignore"
  echo ".pmad/" >> "$PROJECT_ROOT/.gitignore"
  echo "  Added .pmad/ to .gitignore"
else
  echo "  .pmad/ already in .gitignore"
fi

# 4. Check if CLAUDE.md has PMAD entry
if [ -f "$PROJECT_ROOT/CLAUDE.md" ]; then
  if ! grep -q "PMAD" "$PROJECT_ROOT/CLAUDE.md" 2>/dev/null; then
    echo "" >> "$PROJECT_ROOT/CLAUDE.md"
    echo "## PMAD" >> "$PROJECT_ROOT/CLAUDE.md"
    echo "" >> "$PROJECT_ROOT/CLAUDE.md"
    echo "When the developer asks to launch PMAD, load \`pmad/orchestrator.md\` and follow its instructions." >> "$PROJECT_ROOT/CLAUDE.md"
    echo "  Added PMAD entry to CLAUDE.md"
  else
    echo "  PMAD already referenced in CLAUDE.md"
  fi
else
  echo "  No CLAUDE.md found — skipping (create one if needed)"
fi

echo ""
echo "PMAD installed! Available commands:"
echo "  /pmad          — launch with mode selection"
echo "  /pmad-quick    — fast cycle (scan, implement, test, quality)"
echo "  /pmad-full     — complete cycle (scoping, architecture, implementation, tests, quality, review)"
