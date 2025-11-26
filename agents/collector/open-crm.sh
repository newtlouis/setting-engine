#!/bin/bash

# Script pour ouvrir le fichier Excel CRM
EXCEL_FILE="./output/instagram_prospects.xlsx"

if [ ! -f "$EXCEL_FILE" ]; then
    echo "❌ Fichier Excel introuvable: $EXCEL_FILE"
    echo "💡 Lance d'abord un test avec: node test-crm-enhanced.js"
    exit 1
fi

echo "📊 Ouverture du CRM Instagram..."

# Detect OS and open accordingly
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open "$EXCEL_FILE"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    xdg-open "$EXCEL_FILE"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    # Windows
    start "$EXCEL_FILE"
else
    echo "❌ OS non supporté: $OSTYPE"
    exit 1
fi

echo "✅ Fichier ouvert!"
echo ""
echo "💡 Conseil: Trie la colonne 'Score' en ordre décroissant pour voir"
echo "   les prospects les plus engagés en premier!"
