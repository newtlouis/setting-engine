#!/bin/bash

# Script de configuration rapide pour l'auto-login Instagram

echo "🔐 Configuration de l'auto-login Instagram"
echo "=========================================="
echo ""

# Check if .env already exists
if [ -f ".env" ]; then
    echo "⚠️  Un fichier .env existe déjà."
    read -p "Voulez-vous le remplacer ? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Configuration annulée."
        exit 0
    fi
fi

# Copy .env.example to .env
echo "📝 Création du fichier .env..."
cp .env.example .env

# Prompt for Instagram credentials
echo ""
echo "Entrez vos credentials Instagram :"
echo "(Laissez vide pour utiliser le mode manuel)"
echo ""
echo "💡 Les caractères spéciaux (', \", @, #, !, espaces, etc.) sont supportés"
echo ""

read -p "Instagram Username/Email : " ig_username
read -s -p "Instagram Password      : " ig_password
echo ""

# Update .env file if credentials provided
if [ ! -z "$ig_username" ] && [ ! -z "$ig_password" ]; then
    echo ""
    echo "✏️  Mise à jour du fichier .env..."
    
    # Check if password contains special characters that need quotes
    if [[ "$ig_password" =~ [\'\"\ \$\!\@\#] ]]; then
        echo "   ℹ️  Mot de passe avec caractères spéciaux détecté, ajout de guillemets..."
        # Escape any existing double quotes in password
        escaped_password=$(echo "$ig_password" | sed 's/"/\\"/g')
        sed -i '' "s|^INSTAGRAM_USERNAME=.*|INSTAGRAM_USERNAME=$ig_username|" .env
        sed -i '' "s|^INSTAGRAM_PASSWORD=.*|INSTAGRAM_PASSWORD=\"$escaped_password\"|" .env
    else
        # No special chars, simple replacement
        sed -i '' "s|^INSTAGRAM_USERNAME=.*|INSTAGRAM_USERNAME=$ig_username|" .env
        sed -i '' "s|^INSTAGRAM_PASSWORD=.*|INSTAGRAM_PASSWORD=$ig_password|" .env
    fi
    
    echo "✅ Configuration terminée !"
    echo ""
    echo "📊 Résumé :"
    echo "   Username : $ig_username"
    echo "   Password : ********"
    echo ""
    echo "🔒 Sécurité :"
    chmod 600 .env
    echo "   ✅ Permissions du fichier .env définies à 600 (lecture/écriture seule)"
    echo ""
    echo "🚀 Prochaines étapes :"
    echo "   1. Vérifie le parsing : node test-env-parsing.js"
    echo "   2. Teste avec : npm run scrape -- --target-prospects 10"
    echo "   3. Le système va se connecter automatiquement !"
    echo ""
    echo "💡 Tips :"
    echo "   - Active la 2FA sur ton compte Instagram (recommandé)"
    echo "   - Le système gérera automatiquement la 2FA"
    echo "   - Lis AUTOLOGIN_SETUP.md pour plus d'infos"
else
    echo ""
    echo "⚠️  Aucun credential fourni."
    echo "   Le système utilisera le mode manuel (connexion dans le navigateur)."
    echo ""
    echo "💡 Pour activer l'auto-login plus tard :"
    echo "   1. Édite le fichier .env"
    echo "   2. Ajoute INSTAGRAM_USERNAME et INSTAGRAM_PASSWORD"
    echo "   3. Ou relance ce script : ./setup-autologin.sh"
fi

echo ""
echo "📚 Documentation complète : cat AUTOLOGIN_SETUP.md"
