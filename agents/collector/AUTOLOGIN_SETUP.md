# 🔐 Configuration de l'Auto-Login Instagram

## Vue d'ensemble

Le système peut maintenant se connecter automatiquement à Instagram en utilisant tes credentials stockés dans un fichier `.env`. Plus besoin de te connecter manuellement à chaque fois !

## ⚡ Setup Rapide (2 minutes)

### Étape 1 : Créer le fichier .env

```bash
cd /Users/louis/opencode/instagram-lead-engine/agents/collector
cp .env.example .env
```

### Étape 2 : Ajouter tes credentials

Ouvre le fichier `.env` et ajoute ton email/username et mot de passe Instagram :

```bash
# Instagram Credentials (OPTIONAL - for auto-login)
INSTAGRAM_USERNAME=ton_email@exemple.com
INSTAGRAM_PASSWORD=ton_mot_de_passe_instagram
```

**Tu peux utiliser :**
- Ton email Instagram
- Ton nom d'utilisateur Instagram
- Ton numéro de téléphone

**⚠️ Si ton mot de passe contient des caractères spéciaux :**

```env
# ✅ Utilise des guillemets doubles
INSTAGRAM_PASSWORD="Mon'P@ss#123"

# ✅ Exemples de caractères spéciaux supportés
INSTAGRAM_PASSWORD="Pass'avec'apostrophes"
INSTAGRAM_PASSWORD="Pass@avec#symboles!"
INSTAGRAM_PASSWORD="Pass avec espaces"
INSTAGRAM_PASSWORD="Pass$dollar"

# 💡 Le script setup-autologin.sh gère ceci automatiquement !
```

### Étape 3 : Sauvegarder et tester

Sauvegarde le fichier et lance le scraper comme d'habitude :

```bash
npm run scrape -- --target-prospects 50
```

Le système va maintenant :
1. ✅ Se connecter automatiquement avec tes credentials
2. ✅ Gérer les popups "Save Login Info" automatiquement
3. ✅ Gérer les popups "Turn on Notifications" automatiquement
4. ⚠️  Te demander de compléter la 2FA si elle est activée (recommandé)

---

## 🔒 Sécurité

### ✅ Bonnes pratiques

1. **Ne JAMAIS commiter le fichier .env**
   - Le fichier `.env` est déjà dans `.gitignore`
   - Vérifie avec : `git status` (il ne devrait pas apparaître)

2. **Utiliser un mot de passe d'application (recommandé)**
   - Si tu utilises l'authentification 2FA (recommandé), Instagram peut bloquer le login automatique
   - Solution : le système te demandera de compléter la 2FA manuellement

3. **Permissions du fichier**
   ```bash
   chmod 600 .env  # Seul toi peux lire/écrire
   ```

### ⚠️ Risques et limitations

**Instagram peut :**
- Détecter les connexions automatiques fréquentes
- Demander une vérification 2FA (le système le gère)
- Bloquer temporairement ton compte si activité suspecte

**Pour minimiser les risques :**
- ✅ Active la 2FA sur ton compte Instagram
- ✅ Utilise des délais réalistes (déjà configuré)
- ✅ Ne lance pas le scraper trop souvent (max 2-3x/jour)
- ✅ Utilise un compte Instagram "business" dédié si possible

---

## 🎯 Modes de connexion

### Mode 1 : Auto-login (recommandé si pas de 2FA)

**Configuration :**
```env
INSTAGRAM_USERNAME=ton_email@exemple.com
INSTAGRAM_PASSWORD=ton_mot_de_passe
```

**Comportement :**
```
🔐 Auto-login enabled, logging in to Instagram...
   → Waiting for login form...
   → Entering username...
   → Entering password...
   → Clicking login button...
   → Waiting for login response...
   ✅ Auto-login successful!
   → Dismissing "Save Login Info" popup...
   → Dismissing "Turn on Notifications" popup...
```

### Mode 2 : Auto-login avec 2FA

**Configuration :**
- Même que Mode 1
- 2FA activée sur ton compte Instagram

**Comportement :**
```
🔐 Auto-login enabled, logging in to Instagram...
   → Entering username...
   → Entering password...
   
⚠️  Two-factor authentication detected!
   Please complete the 2FA verification in the browser.
   Press ENTER here when you see your Instagram feed...

[Tu complètes la 2FA manuellement dans le navigateur]
[Tu appuies sur ENTER]

✅ Login successful!
```

### Mode 3 : Manual login (sans credentials)

**Configuration :**
```env
# Laisse vide ou supprime les lignes
INSTAGRAM_USERNAME=
INSTAGRAM_PASSWORD=
```

**Comportement :**
```
📱 Opening Instagram...
💡 Tip: Set INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD in .env for auto-login

⏸️  Please log in manually in the browser window.
   Complete any 2FA or security checks.
   Press ENTER here when you see your Instagram feed...
```

---

## 🐛 Troubleshooting

### Problème : "Login failed: Sorry, your password was incorrect"

**Solutions :**
1. Vérifie que ton mot de passe est correct (essaye de te connecter manuellement)
2. Vérifie qu'il n'y a pas d'espaces avant/après le mot de passe dans `.env`
3. **Si ton mot de passe contient des caractères spéciaux** (`'`, `"`, `!`, `@`, `#`, `$`, etc.), utilise des **guillemets doubles** :
   ```env
   # ✅ RECOMMANDÉ : Guillemets doubles
   INSTAGRAM_PASSWORD="M0n'P@ss!#123"
   
   # ✅ Fonctionne aussi : Sans guillemets
   INSTAGRAM_PASSWORD=M0n'P@ss!#123
   
   # ❌ NE PAS FAIRE : Guillemets simples avec apostrophe
   INSTAGRAM_PASSWORD='Mon'Pass'  # ← Erreur !
   ```

4. **Cas particuliers :**
   - Apostrophe `'` : Utilise des guillemets doubles `"Mon'Pass"`
   - Guillemets doubles `"` : Échappe-les `"Mon\"Pass"` ou utilise sans guillemets
   - Espaces : **OBLIGATOIRE** guillemets doubles `"Mon Pass 123"`
   - Dollar `$` : Utilise guillemets doubles `"Pass$123"`

### Problème : "Auto-login failed. Falling back to manual login"

**C'est normal si :**
- Instagram détecte une connexion suspecte
- Ton compte nécessite une vérification
- La 2FA est activée (recommandé !)

**Le système basculera automatiquement en mode manuel.**

### Problème : Le fichier .env n'est pas chargé

**Vérifications :**
```bash
# 1. Le fichier existe-t-il ?
ls -la .env

# 2. Est-il au bon endroit ?
pwd  # Doit être dans agents/collector/

# 3. Contient-il les bonnes variables ?
cat .env | grep INSTAGRAM
```

### Problème : Connexion bloquée par Instagram

**Solutions :**
1. Attends 24h avant de réessayer
2. Connecte-toi manuellement depuis un navigateur normal
3. Vérifie tes emails Instagram pour des alertes de sécurité
4. Utilise le mode manuel pour quelques jours

---

## 📊 Exemple de fichier .env complet

```env
# Instagram Collector Agent Configuration

# Output directory (relative or absolute path)
OUTPUT_DIR=./output

# Debug mode (set to 'true' for verbose logging)
DEBUG=false

# Browser settings
HEADLESS=false
SLOW_MO=100

# Default limits
DEFAULT_MAX_POSTS=50
DEFAULT_MAX_COMMENTS=100

# Delays (milliseconds)
MIN_DELAY=3000
MAX_DELAY=7000

# Instagram Credentials (OPTIONAL - for auto-login)
# WARNING: Keep this file secure and never commit it to git!
INSTAGRAM_USERNAME=louis@exemple.com
INSTAGRAM_PASSWORD=MonMotDePasseSecurise123
```

---

## 🚀 Prochaines étapes

1. **Configure ton .env** (2 min)
2. **Teste l'auto-login** : `npm run scrape -- --target-prospects 10`
3. **Si problème** : Le système bascule automatiquement en mode manuel
4. **Profite !** Tu gagnes 30 secondes à chaque run 🎉

---

## 💡 Tips Pro

### Utiliser un compte dédié

Pour éviter tout risque avec ton compte principal :

1. Crée un compte Instagram "business" dédié
2. Active la 2FA dessus
3. Utilise ce compte pour le scraping
4. Ton compte principal reste protégé

### Rotation de credentials

Si tu as plusieurs comptes Instagram :

```bash
# Profil 1
INSTAGRAM_USERNAME=compte1@exemple.com
INSTAGRAM_PASSWORD=pass1

# Profil 2 (commenté)
# INSTAGRAM_USERNAME=compte2@exemple.com
# INSTAGRAM_PASSWORD=pass2
```

Change simplement les commentaires pour alterner !

---

**Besoin d'aide ?** Lis d'abord la section Troubleshooting ci-dessus.
