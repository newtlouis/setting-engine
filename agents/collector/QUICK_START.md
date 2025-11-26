# 🚀 Quick Start - Instagram Lead Engine

## Lancement Rapide (2 minutes)

### Étape 1 : Configure l'auto-login

```bash
./setup-autologin.sh
```

### Étape 2 : Lance le scraper avec des hashtags OU des profils

Le scraper a besoin de savoir **où chercher** les prospects :

#### Option A : Scraper des hashtags (RECOMMANDÉ pour débuter)

```bash
npm run scrape -- --hashtags marketing entrepreneurship business --target-prospects 50
```

#### Option B : Scraper des profils de concurrents

```bash
npm run scrape -- --profiles https://instagram.com/competitor1 https://instagram.com/competitor2 --target-prospects 50
```

#### Option C : Les deux en même temps

```bash
npm run scrape -- --hashtags marketing --profiles https://instagram.com/competitor1 --target-prospects 50
```

### Étape 3 : Ouvre le CRM

```bash
./open-crm.sh
```

---

## 📖 Exemples Concrets

### Exemple 1 : Coach en développement personnel

```bash
npm run scrape -- \
  --hashtags developpementpersonnel coaching motivation \
  --target-prospects 100
```

### Exemple 2 : E-commerce mode

```bash
npm run scrape -- \
  --profiles https://instagram.com/zara https://instagram.com/hm \
  --target-prospects 50
```

### Exemple 3 : Marketing digital

```bash
npm run scrape -- \
  --hashtags marketingdigital socialmedia contentcreator \
  --profiles https://instagram.com/garyvee \
  --target-prospects 75
```

### Exemple 4 : SaaS B2B

```bash
npm run scrape -- \
  --hashtags saas startup entrepreneur \
  --target-prospects 30
```

---

## 🎯 Modes Disponibles

### Mode 1 : `both` (défaut)
Découvre des posts ET scrape les commentaires

```bash
npm run scrape -- --hashtags marketing --target-prospects 50
```

### Mode 2 : `only-discover`
Découvre juste les posts (sans scraper les commentaires)

```bash
npm run scrape -- --mode only-discover --hashtags marketing
```

### Mode 3 : `scrape-comments`
Scrape uniquement les posts déjà découverts

```bash
npm run scrape -- --mode scrape-comments --target-prospects 50
```

### Mode 4 : `hashtags` ou `profiles`
Utilise uniquement une source

```bash
# Juste hashtags
npm run scrape -- --mode hashtags --hashtags marketing business

# Juste profils
npm run scrape -- --mode profiles --profiles https://instagram.com/competitor1
```

---

## 💡 Bonnes Pratiques

### 1. Choix des Hashtags

✅ **Bons hashtags** (nichés, spécifiques) :
- `marketingdigital` → Audience ciblée
- `coachingentrepreneur` → Niche précise
- `saasfounder` → Très qualifié

❌ **Mauvais hashtags** (trop génériques) :
- `love` → Trop large, pas pertinent
- `instagood` → Spam
- `photooftheday` → Non qualifié

### 2. Nombre de Prospects

- **Petit test** : 10-20 prospects
- **Session normale** : 50-100 prospects
- **Session longue** : 100-200 prospects (attention au rate limiting)

### 3. Fréquence

- **Maximum recommandé** : 2-3 sessions par jour
- **Optimal** : 1 session tous les 2 jours
- **Repos** : 1 jour off par semaine

---

## ⚙️ Options Avancées

### Limiter le nombre de posts

```bash
npm run scrape -- \
  --hashtags marketing \
  --max-posts 20 \
  --target-prospects 50
```

### Limiter le nombre de commentaires par post

```bash
npm run scrape -- \
  --hashtags business \
  --max-comments 50 \
  --target-prospects 30
```

### Mode headless (déconseillé)

```bash
npm run scrape -- \
  --hashtags marketing \
  --headless \
  --target-prospects 20
```

⚠️ **Note** : Le mode headless est détecté par Instagram et peut causer des blocages. Utilise-le uniquement pour des tests rapides.

---

## 🐛 Troubleshooting

### Erreur : "Mode 'both' requires at least one of --hashtags or --profiles"

**Cause** : Tu n'as pas spécifié de source (hashtags ou profils)

**Solution** :
```bash
# Ajoute au moins un hashtag
npm run scrape -- --hashtags marketing --target-prospects 50
```

### Le scraper ne trouve pas assez de prospects

**Causes possibles** :
1. Hashtag trop petit ou inactif
2. Profil concurrent avec peu de commentaires
3. Target trop élevé

**Solutions** :
1. Utilise des hashtags plus populaires
2. Ajoute plusieurs hashtags
3. Baisse le `--target-prospects`

### Instagram demande une vérification

**C'est normal !** Instagram peut demander :
- Vérification email
- Code SMS
- Captcha visuel

**Solution** : Complète la vérification dans le navigateur, puis appuie sur ENTER dans le terminal.

---

## 📊 Workflow Recommandé

### Jour 1 : Discovery

```bash
# Découvre 200 posts sans scraper
npm run scrape -- --mode only-discover --hashtags marketing business startup
```

### Jour 2-3 : Scraping par batch

```bash
# Scrape 50 prospects
npm run scrape -- --mode scrape-comments --target-prospects 50

# Attends 6h

# Scrape 50 autres prospects
npm run scrape -- --mode scrape-comments --target-prospects 50
```

### Jour 4 : Analyse

```bash
# Ouvre le CRM
./open-crm.sh

# Trie par Score
# Contacte les HIGH en priorité
```

---

## 🎯 Template de Commande

Copie-colle et personnalise :

```bash
npm run scrape -- \
  --hashtags HASHTAG1 HASHTAG2 HASHTAG3 \
  --profiles https://instagram.com/CONCURRENT1 \
  --target-prospects 50 \
  --max-posts 30 \
  --max-comments 100
```

**Remplace** :
- `HASHTAG1 HASHTAG2 HASHTAG3` → Tes hashtags cibles
- `CONCURRENT1` → Un profil concurrent
- `50` → Nombre de prospects souhaités

---

## 📚 Ressources

- **Auto-login** : `./setup-autologin.sh`
- **Caractères spéciaux** : `cat SPECIAL_CHARS_GUIDE.md`
- **Documentation complète** : `cat AUTOLOGIN_SETUP.md`
- **Ouvrir CRM** : `./open-crm.sh`

---

## ✅ Checklist Avant de Lancer

- [ ] Auto-login configuré (`./setup-autologin.sh`)
- [ ] Credentials testés (`node test-env-parsing.js`)
- [ ] Hashtags OU profils choisis
- [ ] Target prospects défini (recommandé : 50)
- [ ] Prêt à compléter la 2FA si nécessaire

**C'est parti !** 🚀

```bash
npm run scrape -- --hashtags TES_HASHTAGS --target-prospects 50
```
