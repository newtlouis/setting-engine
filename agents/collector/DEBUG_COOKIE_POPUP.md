# 🐛 Debug du Popup de Cookies Instagram

## Problème Récurrent

Si le popup de cookies **n'est toujours pas fermé**, voici comment débuguer et trouver la solution.

---

## 1️⃣ Identifier le Sélecteur Correct

### Option A : Utiliser le script de test

```bash
cd agents/collector
node test-cookie-popup.js
```

Ce script va :
- ✅ Ouvrir Instagram dans un navigateur visible
- ✅ Tester tous les sélecteurs un par un
- ✅ Afficher quel sélecteur fonctionne
- ✅ Tenter de cliquer sur le bouton

**Résultat attendu** :
```
🧪 Test de détection du popup de cookies Instagram

1️⃣ Navigation vers Instagram login...

2️⃣ Recherche du popup de cookies...

   → Trying: Text: "Allow all cookies"
     ✅ Found! Visible: true

3️⃣ Popup détecté ! Clic sur le bouton...
   Using selector: Text: "Allow all cookies"
   → Attempting normal click...
     ✅ Normal click successful

   ✅ Popup fermé avec succès !

4️⃣ Vérification du formulaire de login...
   ✅ Formulaire de login visible !
```

### Option B : Inspection manuelle dans le navigateur

1. **Ouvre Instagram** dans Chrome/Firefox avec DevTools (F12)
2. **Navigue vers** : `https://www.instagram.com/accounts/login/`
3. **Attend que le popup apparaisse**
4. **Clique droit sur le bouton "Allow all cookies"** → Inspect
5. **Note les informations** :
   - Texte exact du bouton : `____________________`
   - Classes CSS : `____________________`
   - Attributs : `____________________`

---

## 2️⃣ Analyser le HTML du Popup

Copie le HTML complet du popup (comme tu l'as fait) et cherche :

### A. Le bouton principal

```html
<button class="_a9-- _ap36 _asz1" tabindex="0">Allow all cookies</button>
```

**Informations clés** :
- **Texte** : `Allow all cookies`
- **Classes** : `_a9--`, `_ap36`, `_asz1`
- **Type** : `button`

### B. Les sélecteurs possibles

| Sélecteur | Description | Robustesse |
|-----------|-------------|------------|
| `button:has-text("Allow all cookies")` | Basé sur le texte | ⭐⭐⭐⭐⭐ (Meilleur) |
| `button._a9--._ap36._asz1` | Basé sur les classes CSS | ⭐⭐ (Fragile, peut changer) |
| `button[tabindex="0"]` | Basé sur l'attribut | ⭐ (Trop générique) |

**Recommandation** : Toujours préférer les sélecteurs **basés sur le texte visible**.

---

## 3️⃣ Tester le Sélecteur dans la Console

Dans DevTools Console :

```javascript
// Test 1 : Trouve le bouton
const btn = document.querySelector('button:has-text("Allow all cookies")');
console.log('Button found:', btn);

// Test 2 : Vérifie qu'il est visible
console.log('Visible:', btn && btn.offsetParent !== null);

// Test 3 : Essaie de cliquer
if (btn) {
  btn.click();
  console.log('Clicked!');
}
```

---

## 4️⃣ Vérifier les Variantes Linguistiques

Instagram change le texte selon la langue du navigateur :

| Langue | Texte du bouton |
|--------|-----------------|
| 🇬🇧 Anglais | "Allow all cookies" |
| 🇫🇷 Français | "Autoriser tous les cookies" |
| 🇪🇸 Espagnol | "Permitir todas las cookies" |
| 🇩🇪 Allemand | "Alle Cookies zulassen" |
| 🇮🇹 Italien | "Consenti tutti i cookie" |

**Comment tester ta langue** :

1. Change la langue du navigateur
2. Recharge Instagram
3. Note le texte exact du bouton
4. Ajoute-le dans `utils.js`

---

## 5️⃣ Ajouter un Nouveau Sélecteur

Si tu trouves un nouveau format de bouton, ajoute-le dans `src/utils.js` :

```javascript
const cookieSelectors = [
  'button:has-text("Allow all cookies")',          // Existant
  'button:has-text("Autoriser tous les cookies")', // Existant
  'button:has-text("TON_NOUVEAU_TEXTE")',          // ⬅️ AJOUTE ICI
  // ... autres sélecteurs
];
```

**Ordre d'importance** :
1. ⭐⭐⭐⭐⭐ Textes exacts récents (Nov 2024)
2. ⭐⭐⭐⭐ Textes génériques ("Accept", "Allow")
3. ⭐⭐⭐ Variantes linguistiques
4. ⭐⭐ Classes CSS (fragiles)
5. ⭐ Sélecteurs génériques (dernier recours)

---

## 6️⃣ Comprendre Pourquoi le Clic Échoue

### Raisons possibles :

#### A. Overlay invisible
**Symptôme** : Le bouton existe mais le clic ne fonctionne pas

**Solution** : Utiliser `{ force: true }`

```javascript
await cookieButton.click({ force: true });
```

#### B. Bouton pas encore chargé
**Symptôme** : Erreur "Element not found"

**Solution** : Augmenter le délai avant la détection

```javascript
await delay(3000); // Au lieu de 2000
```

#### C. JavaScript bloque le clic
**Symptôme** : Aucune réaction après le clic

**Solution** : Utiliser JavaScript directement

```javascript
await page.evaluate(() => {
  document.querySelector('button').click();
});
```

#### D. Le popup n'apparaît pas
**Symptôme** : Aucun bouton trouvé

**Raisons** :
- Cookie déjà accepté dans ce navigateur ✅ (normal)
- Région géographique sans GDPR 🌍
- Nouveau format de popup 🆕 (à débugger)

---

## 7️⃣ Solutions de Contournement

Si **rien ne fonctionne**, essaie ces workarounds :

### Option 1 : Effacer les cookies du navigateur

```bash
# Supprime le dossier Playwright
rm -rf ~/Library/Caches/ms-playwright

# Réinstalle Playwright
cd agents/collector
npx playwright install chromium
```

### Option 2 : Utiliser un autre navigateur

Dans `src/index.js`, change :

```javascript
// Avant
const browser = await chromium.launch();

// Après
const browser = await firefox.launch();
```

### Option 3 : Login manuel temporaire

Désactive l'auto-login :

```bash
# Dans .env, commente les credentials
# INSTAGRAM_USERNAME=ton_username
# INSTAGRAM_PASSWORD=ton_password
```

### Option 4 : Attente manuelle

Ajoute une pause pour fermer le popup manuellement :

```javascript
// Dans src/utils.js, après la détection du popup
console.log('⏸️  Pause de 10 secondes pour fermer le popup manuellement...');
await delay(10000);
```

---

## 8️⃣ Rapport de Bug

Si aucune solution ne fonctionne, crée une issue avec :

### Template :

```markdown
## 🐛 Popup de cookies non fermé

**Date** : Nov 26, 2024
**Région** : France / USA / ...
**Navigateur** : Chromium 120.x

### HTML du popup
\`\`\`html
[Colle le HTML complet ici]
\`\`\`

### Texte du bouton
"Allow all cookies" / "Autre texte"

### Classes CSS
`_a9-- _ap36 _asz1` / Autres

### Logs du test
\`\`\`
[Colle la sortie de `node test-cookie-popup.js`]
\`\`\`

### Ce que j'ai essayé
- [ ] Script de test (`test-cookie-popup.js`)
- [ ] Effacement des cookies Playwright
- [ ] Changement de navigateur
- [ ] Ajout de nouveaux sélecteurs
- [ ] Augmentation des délais
```

---

## 9️⃣ Checklist de Debug

Avant de signaler un bug, vérifie :

- [ ] J'ai lancé `node test-cookie-popup.js`
- [ ] J'ai inspecté le HTML du popup
- [ ] J'ai testé les sélecteurs dans DevTools Console
- [ ] J'ai vérifié la langue de mon navigateur
- [ ] J'ai effacé les cookies Playwright
- [ ] J'ai attendu 5+ secondes après le chargement de la page
- [ ] J'ai testé avec et sans `{ force: true }`
- [ ] J'ai lu les logs complets de l'erreur
- [ ] J'ai essayé le login manuel (pour confirmer que c'est bien le popup le problème)

---

## 🎯 Résultat Attendu

Après le fix, tu devrais voir :

```
🔐 Auto-login enabled, logging in to Instagram...
   → Checking for cookie consent popup...
   → Found cookie button with selector: button:has-text("Allow all cookies")
   → Accepting cookies...
   ✅ Cookie popup handled with JavaScript
   → Waiting for login form...
   → Entering username...
   → Entering password...
   → Clicking login button...
   → Waiting for login response...
   ✅ Auto-login successful!
```

---

## 📚 Ressources

- [Playwright Selectors](https://playwright.dev/docs/selectors)
- [Playwright Force Click](https://playwright.dev/docs/input#forcing-the-click)
- [Instagram Cookie Policy](https://help.instagram.com/1896641480634370)

---

**Bonne chance !** 🍀

Si tu as suivi tous ces steps et que ça ne marche toujours pas, partage les résultats de `test-cookie-popup.js` et on trouvera une solution. 💪
