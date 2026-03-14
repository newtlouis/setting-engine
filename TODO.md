# TODO — Setting Engine

## Katessence — Pistes d'amelioration funnel

### Test d'auto-evaluation comme CTA alternatif
- Au STEP_5, quand le prospect hesite pour un appel, proposer un test d'auto-evaluation en alternative
- Moins engageant qu'un appel, peut debloquer des prospects qui disent "non" a l'appel
- Necessite : creer le test, l'heberger, ajouter un branchement dans le script STEP_5
- Inspire de la trame "jeunes entrepreneurs" (step 7)

### Variantes de messages selon le profil detecte
- Plutot que 2 trames completes, adapter certains messages en fonction de ce qu'on apprend en STEP_2/3
- Exemple STEP_5 prospect mature : "faire un point strategique sur ton ecosysteme business"
- Exemple STEP_5 prospect plus junior : "prendre 30 min pour voir si je peux t'apporter des pistes"
- Le LLM pourrait adapter le registre dynamiquement si on lui donne des variantes dans le script

### 2 trames differentes (analyse)
- Idee : avoir une trame "jeunes entrepreneurs" et une trame "entrepreneurs affirmes"
- Probleme : on ne sait pas quel profil c'est avant STEP_2/3, donc la divergence ne peut pas se faire au STEP_1
- Conclusion : une seule trame avec variantes internes est plus pragmatique
- Les 2 trames de reference sont documentees ci-dessous pour inspiration

### Trames de reference (prospection a froid)

<details>
<summary>Trame jeunes entrepreneurs</summary>

1. "Hello [Prenom], tu proposes toujours un accompagnement ?"
2. "Ok c'est top ! Donc pour tout te dire, je suis tombe sur ton profil et je le trouvais hyper interessant donc je me suis dit que ca pouvait etre une bonne idee de te contacter pour connecter et te partager un maximum de valeur. Est-ce que du coup tu serais contre l'idee d'echanger sur ton activite ?"
3. "Ah yes par exemple depuis combien de temps est ce que tu fais ca de ton cote ?"
4. "Super ! tu veux bien m'en dire plus sur ce que tu proposes ?"
5. "Ah cool ca bravo. Et d'ou t'es venu l'idee ?"
6. "Super ! A ton sens ca va etre quoi le challenge que tu vas devoir relever durant les prochains mois si c'est pas indiscret ?"
7. "Je sais pas si tu as vue mais j'ai mis en place un test d'auto-evaluation qui apporte des reponses personnalises a notre situation. Est-ce que tu veux que je te le partage ?"
7bis. "C'est un sacre challenge ! A la limite, ce que je peux te proposer, c'est de prendre 30 minutes avec toi dans la semaine, afin de voir si je peux pas t'apporter mon aide. Pas de piege, pas de vente juste une session ensemble pour toi. Si c'est ok pour toi bien entendu ?"
8. "Super, voici mon numero : XXXX. Je peux avoir le tien pour confirmer sur WhatsApp ?"

</details>

<details>
<summary>Trame entrepreneurs affirmes</summary>

1. "Hola [Prenom], Je suis Mentor en developpement d'affaires, et mise en relation publique. J'interviens sur plusieurs leviers cles d'une activite en ligne (offre, acquisition, conversion et delivrabilite) avec un seul objectif : aider a structurer un modele d'affaire qui honore le temps et l'energie du Leader Visionnaire. Est ce que tu sens qu'un de ces leviers merite d'etre renforce pour booster la croissance de ton activite ?"
1bis. "Hola [Prenom], Ecoute c'est juste ouf, on a aide X Coach et Mentor depuis X temps a atteindre X resultats, on a fait une demo ou on propose une video gratuite pour la personne pour voir comment on peut l'appliquer a son entreprise, est-ce que ca vous dit si on vous l'envoie ?"

</details>

### Analyse des trames de reference
- **Points forts** : step 1 "tu proposes toujours un accompagnement" (presuppose familiarite), test auto-eval comme CTA doux, vocabulaire "Leader Visionnaire"
- **Points faibles** : messages trop longs pour IG DM, ton trop marketing/script, pas d'arbres de decision, "Bravo/Super" a chaque reponse (fait IA)

---

## Autres pistes identifiees

### Priorisation intelligente des leads
- Repondre en priorite aux prospects qui matchent le plus l'avatar
- Impact reel surtout quand le volume de leads est eleve

### Adaptation dynamique du ton par le LLM
- Prospect tres "Camille" (avatar) → ton strategique, direct, entre pairs
- Prospect moins mature → ton plus accompagnant, pedagogique
- Subtil et difficile a mesurer, nice-to-have

### Strategie de contenu (posts IG)
- Utiliser les douleurs/desirs de l'avatar pour generer des accroches de posts
- Exemple : "Ton business fonctionne mais il ne te soutient plus ?"
