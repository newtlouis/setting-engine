# 🎯 Système d'évaluation de l'engagement

## Vue d'ensemble

L'algorithme d'évaluation de l'engagement analyse les commentaires des prospects pour déterminer leur niveau d'intérêt et leur qualité en tant que leads.

## 📊 Comment ça marche ?

### Critères d'évaluation (Total: 50 points)

#### 1. **Fréquence** (0-10 points)
- Plus un utilisateur commente souvent, plus il est engagé
- Calcul: `min(nombre_commentaires × 2, 10)`
- Exemple: 5 commentaires = 10 points

#### 2. **Récence** (0-15 points)
- Les commentaires récents ont plus de valeur
- Moins de 7 jours: +5 points par commentaire
- Entre 7-30 jours: +3 points par commentaire  
- Entre 30-90 jours: +1 point par commentaire
- Plus de 90 jours: 0 point
- Maximum: 15 points

#### 3. **Qualité** (0-10 points)
- Longueur des commentaires
- Plus de 100 caractères: +3 points
- Entre 50-100 caractères: +2 points
- Entre 20-50 caractères: +1 point
- Moins de 20 caractères: 0 point
- Maximum: 10 points

#### 4. **Patterns d'engagement** (0-10 points)
- `?` (questions): +2 points → Indique une intention/curiosité
- Emojis: +1 point → Engagement émotionnel
- `!` (exclamation): +1 point → Enthousiasme
- `@` (mentions): +1 point → Conversation
- Maximum: 10 points

#### 5. **Longueur moyenne** (0-5 points)
- Moyenne > 100 caractères: +5 points (conversations)
- Moyenne > 50 caractères: +3 points (engagé)
- Moyenne > 20 caractères: +1 point (basique)

## 🏆 Classification finale

| Score | Niveau | Description | Priorité |
|-------|--------|-------------|----------|
| ≥ 25 | **HIGH** | Très engagé, conversations actives | 🔥 Contacter en priorité |
| 12-24 | **MEDIUM** | Modérément engagé, plusieurs interactions | 👍 Bon prospect |
| < 12 | **LOW** | Faible engagement, peu d'interactions | 💤 À surveiller |

## 📈 Exemples réels

### Prospect HIGH (43 points)
```
Utilisateur: @marketing_expert
Commentaires: 4
- "This is amazing! How did you achieve this? I'd love to learn! 🔥" (hier)
- "@yourpage Thanks for the explanation! Really helpful 🙏" (il y a 3j)
- "Can't wait for your next post! Top quality! 💯" (il y a 5j)
- "Just tried this and it worked perfectly! 🚀" (il y a 8j)

Score détaillé:
- Fréquence: 8 points (4 commentaires)
- Récence: 15 points (tous récents)
- Qualité: 10 points (commentaires longs)
- Patterns: 8 points (questions, emojis, @mentions)
- Moyenne: 5 points (>100 chars en moyenne)
= 46 points → HIGH
```

### Prospect MEDIUM (22 points)
```
Utilisateur: @casual_follower
Commentaires: 3
- "Great content! Really appreciate this 👍" (il y a 4j)
- "Nice tips!" (il y a 10j)
- "Thanks for this!" (il y a 15j)

Score détaillé:
- Fréquence: 6 points (3 commentaires)
- Récence: 11 points (récents mais pas très)
- Qualité: 3 points (courts)
- Patterns: 3 points (emojis, exclamation)
- Moyenne: 1 point (courts)
= 24 points → MEDIUM
```

### Prospect LOW (8 points)
```
Utilisateur: @emoji_only
Commentaires: 1
- "🔥" (il y a 2j)

Score détaillé:
- Fréquence: 2 points (1 commentaire)
- Récence: 5 points (récent)
- Qualité: 0 points (très court)
- Patterns: 1 point (emoji)
- Moyenne: 0 point
= 8 points → LOW
```

## 🛠️ Utilisation

### Dans le fichier Excel

Le fichier `instagram_prospects.xlsx` contient maintenant:

1. **Colonne "Engagement Level"**: HIGH/MEDIUM/LOW
2. **Colonne "Score"**: Score numérique (0-50)

### Tri recommandé

Pour prioriser tes prospects:
1. Ouvre le fichier Excel
2. Trie par colonne "Score" (décroissant)
3. Contacte d'abord les HIGH (≥25)
4. Puis les MEDIUM prometteurs (15-24)

## 🔧 Personnalisation

Tu peux ajuster les seuils dans `src/excel_writer.js`:

```javascript
// Ligne ~336
if (score >= 25) level = 'HIGH';    // Modifier ici
else if (score >= 12) level = 'MEDIUM';
else level = 'LOW';
```

### Suggestions de personnalisation par industrie

**B2B/Consulting** (prospects sérieux):
- HIGH: ≥ 30 (plus strict)
- MEDIUM: ≥ 18

**E-commerce/B2C** (volume important):
- HIGH: ≥ 20 (moins strict)
- MEDIUM: ≥ 10

**Coaching/Formation** (engagement émotionnel):
- Ajouter bonus pour certains mots-clés
- "help", "learn", "course" → +3 points

## 📊 Métriques de performance

Pour évaluer la qualité de tes prospects:

```bash
# Ouvre Excel et analyse la distribution
HIGH:   > 20% → Excellente qualité de prospects
MEDIUM: 40-50% → Bon équilibre
LOW:    < 30% → Posts bien ciblés
```

Si tu as trop de LOW:
- Cible des posts avec plus d'engagement
- Utilise des hashtags plus nichés
- Scrape des concurrents directs

## 🎯 Prochaines étapes

1. **Test**: Lance `node test-crm-enhanced.js`
2. **Ouvre**: `./open-crm.sh` ou `open output/instagram_prospects.xlsx`
3. **Analyse**: Regarde la distribution des scores
4. **Ajuste**: Modifie les seuils si nécessaire
5. **Contact**: Commence par les HIGH !

---

**Note**: L'algorithme évolue avec le temps. N'hésite pas à l'ajuster selon tes observations terrain !
