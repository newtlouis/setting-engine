#!/bin/bash

###############################################################################
# Test All - Instagram Lead Engine
# 
# Ce script lance tous les tests disponibles pour vérifier le système
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         🧪 Test Suite - Instagram Lead Engine                 ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

run_test() {
  local test_name="$1"
  local test_cmd="$2"
  
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "${BLUE}📋 Test $TESTS_TOTAL: $test_name${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  
  if eval "$test_cmd"; then
    echo ""
    echo -e "${GREEN}✅ PASSED: $test_name${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo ""
    echo -e "${RED}❌ FAILED: $test_name${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# Test 1: Vérifier que les dépendances sont installées
run_test "Dependencies Check" "npm list playwright >/dev/null 2>&1"

# Test 2: Vérifier la syntaxe JavaScript
run_test "JavaScript Syntax Check" "node -c src/utils.js && node -c src/index.js && node -c src/config.js"

# Test 3: Vérifier que les scripts existent
run_test "Scripts Existence Check" "[[ -f test-cookie-popup.js ]] && [[ -f test-env-parsing.js ]] && [[ -f test-engagement.js ]]"

# Test 4: Vérifier que le .env existe (ou .env.example)
run_test ".env Configuration Check" "[[ -f .env ]] || [[ -f .env.example ]]"

# Test 5: Test du parsing du .env
if [[ -f .env ]]; then
  echo -e "${YELLOW}⏩ Skipping .env parsing test (interactive)${NC}"
else
  echo -e "${YELLOW}⚠️  No .env file found, run: ./setup-autologin.sh${NC}"
fi

# Test 6: Test de l'algorithme d'engagement
run_test "Engagement Scoring Algorithm" "node test-engagement.js"

# Test 7: Test du CRM (si pas de timeout)
echo ""
echo -e "${YELLOW}⏩ Skipping CRM test (requires Excel)${NC}"

# Test 8: Test du popup de cookies (interactif - on le skip)
echo ""
echo -e "${YELLOW}⏩ Skipping cookie popup test (interactive)${NC}"
echo "   To run manually: node test-cookie-popup.js"

# Test 9: Vérifier les permissions des scripts
run_test "Script Permissions" "[[ -x setup-autologin.sh ]] && [[ -x open-crm.sh ]]"

# Test 10: Vérifier que la documentation existe
run_test "Documentation Check" "[[ -f AUTOLOGIN_SETUP.md ]] && [[ -f COOKIE_POPUP_FIX.md ]] && [[ -f DEBUG_COOKIE_POPUP.md ]]"

# Summary
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                       📊 Test Summary                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "Total Tests:  ${BLUE}$TESTS_TOTAL${NC}"
echo -e "Passed:       ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed:       ${RED}$TESTS_FAILED${NC}"
echo ""

if [[ $TESTS_FAILED -eq 0 ]]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  echo ""
  echo "🚀 Your system is ready to scrape Instagram!"
  echo ""
  echo "Next steps:"
  echo "  1. Configure auto-login:  ./setup-autologin.sh"
  echo "  2. Test cookie popup:     node test-cookie-popup.js"
  echo "  3. Start scraping:        npm run scrape -- --hashtags marketing --target-prospects 10"
  echo ""
  exit 0
else
  echo -e "${RED}❌ Some tests failed!${NC}"
  echo ""
  echo "Please fix the issues above before running the scraper."
  echo ""
  echo "For help:"
  echo "  - Read: DEBUG_COOKIE_POPUP.md"
  echo "  - Read: AUTOLOGIN_SETUP.md"
  echo "  - Run: npm install (to fix dependencies)"
  echo ""
  exit 1
fi
