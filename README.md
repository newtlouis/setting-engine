# Setting Engine

**Trois agents autonomes coordonnés par une base partagée.** Node.js · SQLite · Playwright.

Un système de suivi de prospection commerciale sur les réseaux sociaux, de la découverte
d'un contact jusqu'à la conversation. Projet personnel, conçu et développé seul, en service
depuis 2025.

---

## Le problème

Un cycle de prospection a trois temps qui n'ont ni le même rythme ni les mêmes contraintes :
découvrir des contacts pertinents, engager un premier échange, puis suivre les conversations
en cours. En faire un seul programme séquentiel ne marche pas — chaque étape doit pouvoir
tourner seule, à sa fréquence, sans bloquer les autres ni perdre l'état de ce qui a déjà
été fait.

## L'architecture

**La base de données est le seul point de rendez-vous.** Il n'y a pas de file de messages,
pas d'appel direct d'un agent à un autre, pas d'ordonnanceur central : chaque agent lit
l'état dont il a besoin, agit, et écrit le nouvel état. Un agent peut tomber, être relancé
ou rester à l'arrêt une semaine sans que les autres s'en aperçoivent.

```
                    ┌──────────────────┐
     découverte ───▶│                  │◀─── tableau de bord (lecture)
                    │   base SQLite    │
   premier contact ▶│  (état partagé)  │
                    │                  │
    conversations ─▶└──────────────────┘
```

| Agent | Responsabilité | Transition d'état |
|---|---|---|
| **Collector** | Découvre les contacts pertinents, les qualifie par un score d'engagement | → `new` |
| **Outreach** | Sélectionne les meilleurs profils, prépare un premier message contextualisé | `new` → `outreach` |
| **DM Responder** | Analyse l'historique d'un échange, propose une réponse, relance les contacts restés sans réponse | `outreach` → `conversation` |
| **Dashboard** | Vue en lecture seule sur l'état courant, sélection de compte | — |

### Les décisions qui structurent le projet

1. **La base comme unique contrat.** Le coût : aucune réaction en temps réel, tout est en
   différé. Le bénéfice : des agents réellement indépendants, testables isolément, et un
   état inspectable à tout moment avec un simple client SQLite. C'est le bon compromis ici
   parce que rien dans ce domaine n'est urgent à la seconde.
2. **Rien ne part sans revue humaine.** Chaque message est prévisualisé avant envoi, et la
   connexion au compte est manuelle. Un système qui agit à votre place doit rester sous
   contrôle — c'est une contrainte de conception, pas une option de configuration.
3. **Un navigateur réel authentifié** (Playwright, en mode visible) plutôt qu'une API
   détournée : ce qui est automatisé reste ce qu'un utilisateur peut faire lui-même.
4. **Une séparation domaine / application assumée**, avec conteneur d'injection de
   dépendances, cas d'usage et dépôts — et une liste explicite de **ce qui n'est
   volontairement pas implémenté**, pour éviter la sur-ingénierie. Le détail est dans
   [`ARCHITECTURE.md`](ARCHITECTURE.md).
5. **Le cloisonnement multi-comptes dès le départ** : toutes les requêtes sont filtrées par
   `account_id`. Rétrofitter un cloisonnement sur un modèle qui ne l'a pas prévu coûte
   beaucoup plus cher que de le poser au début.

## Ce que ce projet démontre

- concevoir un système multi-agents complet et le mener jusqu'à un état réellement utilisable ;
- choisir une coordination par état partagé plutôt qu'une orchestration, et savoir dire
  pourquoi — et ce que ça coûte ;
- automatiser un navigateur de façon fiable sur une interface qui change ;
- **évaluer la qualité des réponses générées par un LLM par des tests automatisés**
  (`agents/dmresponder/tests/e2e-llm-evaluation.test.js`), plutôt que de juger à l'œil.

## Cadre d'usage

Ce système assiste une démarche commerciale, il ne la remplace pas :

- la connexion au compte est **manuelle**, les identifiants restent locaux (`.env`) ;
- **aucun envoi automatique sans prévisualisation** ni validation ;
- il n'est pas conçu pour l'envoi de masse, et ne doit pas en servir ;
- les données collectées restent sur la machine de l'utilisateur, dans une base locale.

## Démarrer

```bash
npm install
npx playwright install chromium   # nécessaire pour Collector et Outreach
node open_session.js              # ouvrir une session et se connecter manuellement
```

Les commandes de chaque agent sont documentées dans [`COMMANDS.md`](COMMANDS.md).

## Documentation

| Fichier | Contenu |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Couches, principes SOLID appliqués, injection de dépendances, et ce qui n'est pas implémenté |
| [`AGENTS.md`](AGENTS.md) | Rôle détaillé de chaque agent |
| [`COMMANDS.md`](COMMANDS.md) | Toutes les commandes disponibles |
| [`CHANGELOG.md`](CHANGELOG.md) | Historique des évolutions |

---

Développé par **Louis Michel** — développeur freelance Symfony / PHP.
[Malt](https://www.malt.fr/profile/louismichel2) ·
[LinkedIn](https://www.linkedin.com/in/louis-michel-080827bb/)
