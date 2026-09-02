# Retrieval_Options_Plan.md — Options pour fiabiliser la récupération

> Document de **conception**, pas d'implémentation. Il propose quatre approches
> alternatives ou complémentaires au pipeline décrit dans `Retrieval_Plan.md`.
> Objectif unique : **remonter les bons documents et surtout ne jamais rater un
> document important** (le rappel prime sur la précision — un doc en trop coûte
> quelques centaines de caractères de prompt, un doc manquant coûte une réponse
> fausse).
>
> Chaque approche est décrite avec : ce qu'elle change dans le pipeline actuel,
> pourquoi elle répond à *notre* problème, ses points faibles, son usage
> habituel dans l'industrie, et ce avec quoi elle se combine.

---

## 0. Résumé — pourquoi on rate des documents aujourd'hui

Le pipeline actuel est un **bi-encodeur dense mono-signal, à filtre dur, sur un
index de proxys**. Six angles morts en découlent, et chaque approche ci-dessous
en attaque un ou plusieurs.

```
   ANGLE MORT                                       ÉTAPE CONCERNÉE (Retrieval_Plan)
 ┌────────────────────────────────────────────────┬──────────────────────────────┐
 │ ① Le CONTENU des docs n'est jamais indexé.     │ Phase 0 — indexation         │
 │   On n'embedde que les strings curatées de     │                              │
 │   metaContexte[]. Une info présente dans le    │  ⇒ cause n°1 des documents   │
 │   .md mais absente des questions curatées est  │     invisibles               │
 │   littéralement INVISIBLE au retrieval.        │                              │
 ├────────────────────────────────────────────────┼──────────────────────────────┤
 │ ② Filtre dur, en cascade, non réversible.      │ Étape 3a/3b — rankStore      │
 │   MIN_SCORE 0.89 puis SCORE_MARGIN 0.01 (≈     │                              │
 │   top-1). Un doc éliminé ne revient JAMAIS :   │  ⇒ aucun second étage de     │
 │   il n'y a pas de deuxième étage.              │     repêchage                │
 ├────────────────────────────────────────────────┼──────────────────────────────┤
 │ ③ Un seul signal : le cosinus dense.           │ Étape 3 — cosine()           │
 │   Aucune garantie sur les tokens rares / exacts│                              │
 │   (RNCP, TIG, ft_transcendence, C++ Module 07) │  ⇒ le dense « lisse » les    │
 │                                                │     entités rares            │
 ├────────────────────────────────────────────────┼──────────────────────────────┤
 │ ④ La question est embeddée BRUTE, une fois.    │ Étape 1 — generateEmbedding  │
 │   Pas de reformulation, pas de découpage des   │                              │
 │   questions à double intention.                │  ⇒ 1 requête = 1 chance      │
 ├────────────────────────────────────────────────┼──────────────────────────────┤
 │ ⑤ gateSubjectsPdf() : arbitrage binaire entre  │ Étape 4 — gate PDF           │
 │   deux stores via une comparaison de scores    │                              │
 │   non commensurables.                          │  ⇒ stopgap assumé            │
 ├────────────────────────────────────────────────┼──────────────────────────────┤
 │ ⑥ Seuils absolus figés (0.89, 0.01, 0.10) sur  │ §5.3 / §5.4 des constantes   │
 │   une échelle cosinus non calibrée, dépendante │                              │
 │   du modèle et de la longueur de la requête.   │  ⇒ réglage à l'aveugle       │
 └────────────────────────────────────────────────┴──────────────────────────────┘
```

**Les quatre approches proposées :**

| # | Approche | Angles morts traités | Coût latence | Ré-indexation | Difficulté |
|---|---|---|---|---|---|
| **A** | Recherche **hybride** lexicale (BM25) + dense, fusionnée par RRF | ①③⑥ | ≈ 0 (CPU, local) | non (index à part) | faible |
| **B** | Indexer le **contenu en chunks** + **rerank** en 2 étages | ①②⑥ | +0,3 à 2 s | oui (gros) | moyenne |
| **C** | **Transformation de la requête** avant embedding (multi-query + HyDE) | ④③ | +1 à 3 s | non | faible/moyenne |
| **D** | **Routage par intention** + index **hiérarchique** doc→section | ⑤①② | ≈ +0,5 s | oui (moyenne) | moyenne |

**En une phrase :** A élargit *les signaux*, B élargit *ce qui est indexé et
ajoute un juge*, C élargit *les requêtes*, D élargit *la structure*. Elles ne
sont pas concurrentes — la combinaison A+B est le standard de fait, C et D sont
des surcouches.

---

## A. Recherche hybride — lexical (BM25) + dense, fusion RRF

> **Recap.** On garde exactement le retrieval dense actuel, et on lui ajoute en
> parallèle un moteur lexical classique (BM25) qui, lui, indexe le **texte réel**
> des documents. Les deux listes de résultats sont ensuite fusionnées par
> *Reciprocal Rank Fusion*. Un document remonte s'il est bon sur **l'un** des
> deux signaux — jamais l'inverse.

### Schéma

```
                         question brute
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
  ┌─────────────────────┐              ┌──────────────────────────┐
  │ CANAL DENSE (actuel)│              │ CANAL LEXICAL (nouveau)  │
  │ embedding 1024d     │              │ BM25 / TF-IDF            │
  │ vs metaContexte     │              │ index sur le TEXTE des   │
  │ (vector_store.json) │              │ .md + du texte PDF extrait│
  │ MIN_SCORE assoupli  │              │ tokenisation FR + stems  │
  │ → top-20            │              │ → top-20                 │
  └─────────┬───────────┘              └───────────┬──────────────┘
            │  [doc, rang_dense]                   │ [doc, rang_lex]
            └──────────────┬──────────────────────┘
                           ▼
          ┌────────────────────────────────────────────┐
          │  FUSION RRF                                 │
          │  score(d) = Σ  1 / (k + rang_i(d)) , k=60   │
          │  ─ un doc absent d'une liste n'est pas puni │
          │  ─ pas besoin que les scores soient sur la  │
          │    même échelle (c'est le point clé)        │
          └────────────────────┬───────────────────────┘
                               ▼
                   top-N fusionné  →  cap MAX_DOCS  →  Phase 2
```

### Ce que ça change concrètement

- **Phase 0** : un second index, lexical, construit à partir des fichiers
  `documents/Notion/*.md` et du texte PDF déjà extractible via
  `subjectsPdfText.service.js`. Rapide, pas d'Ollama, pas de GPU.
- **Étape 3** : `rankStore()` renvoie un **top-k large** (20) au lieu d'une
  liste déjà coupée ; `MIN_SCORE` et `SCORE_MARGIN` deviennent des paramètres du
  canal dense, et la **coupe finale se fait après fusion**.
- `gateSubjectsPdf()` peut disparaître : RRF fusionne des rangs, pas des scores,
  donc Notion et PDF deviennent comparables sans heuristique (angle mort ⑤ en
  bonus).

### Pourquoi ça marche pour nous

Le corpus est truffé d'**entités rares à correspondance exacte** : `RNCP`,
`TIG`, `libft`, `ft_transcendence`, `C++ Module 07`, noms de salles, sigles 42.
C'est précisément là qu'un embedding dense est faible (il rapproche les concepts,
il ne garantit pas les tokens) et qu'un BM25 est imbattable. À l'inverse le
dense capte les paraphrases (« comment je me connecte au réseau » → `Wi-Fi`) que
BM25 rate. **Les deux canaux échouent sur des requêtes différentes**, ce qui est
exactement la condition pour que la fusion augmente le rappel.

Bonus structurel : BM25 indexant le **contenu**, il couvre partiellement l'angle
mort ① sans toucher au store d'embeddings — c'est le meilleur rapport
gain/effort du document.

### Points forts

- Rappel nettement supérieur sur sigles, noms propres, codes, versions.
- **Aucun coût GPU, aucune latence significative** (quelques ms sur 38+48 docs).
- N'invalide rien : le store d'embeddings existant est réutilisé tel quel.
- RRF est robuste : pas de pondération à régler, pas de normalisation de scores.
- Fournit un **filet de sécurité** : même si le dense se dégrade (changement de
  modèle, store périmé), le lexical continue de répondre.

### Points faibles / risques

- BM25 en français demande un minimum de traitement (accents, pluriels,
  stemming léger) ; sans ça `délégué`/`délégués` sont deux tokens.
- Ne résout pas le vrai **vocabulaire mismatch** (question et doc n'ont aucun
  mot en commun) — c'est le rôle du dense, d'où la fusion.
- Sur un corpus aussi petit, BM25 peut être bruyant sur les mots fréquents du
  domaine (« 42 », « étudiant », « projet ») : il faut une stop-list maison.
- Deux index à maintenir cohérents lors de l'ajout d'un document (l'ajout est
  déjà à 3 endroits ; ça en fait 4 — sauf à construire le BM25 **au boot** en
  scannant le disque, ce qui est recommandé ici).

### Usage habituel

C'est le **défaut de l'industrie** : Elasticsearch/OpenSearch hybrid search,
Vespa, Weaviate, Qdrant, Azure AI Search, tous exposent hybride + RRF en une
option. Employé partout où le corpus contient des identifiants, de la
documentation technique, du juridique, des références produit. Quand une équipe
dit « on a doublé notre recall@5 sans toucher au modèle », c'est presque
toujours ça.

### Complémentarités

- **A + B** : la combinaison canonique — hybride pour le rappel, rerank pour la
  précision. A produit un candidate set large et bruyant, B le nettoie. Si tu
  n'implémentes que deux choses, c'est celles-là.
- **A + C** : chaque reformulation de C traverse les deux canaux → rappel maximal.
- **A + D** : le routeur de D peut pondérer les canaux (question « projet » →
  poids lexical fort sur les noms de projets).

---

## B. Indexer le contenu en chunks + rerank en deux étages

> **Recap.** Deux changements liés. (1) On arrête d'indexer *uniquement* des
> questions curatées : on indexe aussi le **texte réel** des documents, découpé
> en passages. (2) On remplace le filtre dur unique par une architecture
> **retrieve-then-rerank** : premier étage volontairement laxiste et large,
> second étage précis qui relit question + passage ensemble.

### Schéma

```
 PHASE 0 (modifiée)
 ┌──────────────────────────────────────────────────────────────────┐
 │  doc.md ──► découpage en passages de 600–800 tokens,             │
 │             chevauchement 15 %, coupé aux frontières de titres    │
 │  chaque passage ──► embedding ──► store                          │
 │  ON GARDE les metaContexte curatés : ils deviennent des vecteurs  │
 │  supplémentaires du même doc (haute précision) à côté des         │
 │  vecteurs de contenu (haut rappel)                                │
 └──────────────────────────────────────────────────────────────────┘

 EXÉCUTION — deux étages
 ┌── ÉTAGE 1 : RAPPEL ─────────────────────────────────────────────┐
 │  seuil quasi supprimé (MIN_SCORE ~0.75), pas de SCORE_MARGIN     │
 │  → top-30 PASSAGES (pas documents), tous stores confondus        │
 │  coût : cosinus pur, ~ms                                         │
 └────────────────────────┬────────────────────────────────────────┘
                          ▼
 ┌── ÉTAGE 2 : PRÉCISION (rerank) ─────────────────────────────────┐
 │  pour chaque passage : score = f(question, passage) ENSEMBLE     │
 │                                                                  │
 │   bi-encodeur (actuel)          cross-encoder (nouveau)          │
 │   q ─►[enc]─►vec ⟍                    ┌──────────────┐           │
 │                    cos               │ q ⊕ passage  │──► 0..1    │
 │   d ─►[enc]─►vec ⟋                    └──────────────┘           │
 │   ✗ q et d jamais vus ensemble        ✓ attention croisée        │
 │   ✓ pré-calculable                    ✗ 1 passe par candidat     │
 │                                                                  │
 │  variante sans modèle dédié : LLM-as-reranker — un seul appel     │
 │  mistral via le proxy /ollama, « note de 0 à 10 la pertinence     │
 │  de chacun de ces 30 extraits », sortie JSON                     │
 └────────────────────────┬────────────────────────────────────────┘
                          ▼
       top-5 passages ──► regroupement par document parent
                     ──► Phase 2 (buildPrompt) avec les passages,
                         pas les documents entiers
```

### Ce que ça change concrètement

- **Phase 0** : `generateVectorStore.js` embedde aussi le contenu chunké. Le
  store grossit (facteur 2–4) — attention à la limite GitHub de 100 MB déjà
  frôlée ; c'est le moment de sortir les stores de git ou de passer sur un vrai
  index (`sqlite-vec`, `hnswlib`, ou Postgres + `pgvector` — **la base est déjà
  là**).
- **Étape 3** : `MIN_SCORE`/`SCORE_MARGIN` ne coupent plus, ils sélectionnent un
  large candidate set.
- **Étape nouvelle 3.5** : le rerank.
- **Phase 2, étape 3** (`selectPromptDocuments`) : le budget
  `MAX_CONTEXT_CHARS` se remplit de **passages pertinents** au lieu des 15 000
  premiers caractères d'un document. Effet secondaire majeur : à budget égal on
  met **plus d'information utile** dans le prompt, et la latence de génération
  baisse.

### Pourquoi ça marche pour nous

C'est l'approche qui attaque frontalement l'angle mort ① : aujourd'hui, si un
étudiant demande un détail réellement écrit dans un `.md` mais que personne n'a
pensé à ajouter à `claudeQuestions.json`, **aucun réglage de seuil ne peut le
récupérer**. Indexer le contenu supprime cette classe entière d'échecs, et rend
le corpus auto-suffisant : ajouter un document ne dépend plus de la qualité des
questions curatées écrites à la main.

Le rerank, lui, est ce qui rend le rappel élargi **soutenable** : on peut oser un
top-30 laxiste parce qu'un juge derrière fait le tri. Le couple est
indissociable — élargir sans reranker, c'est juste noyer le prompt.

### Points forts

- Traite la cause racine du problème posé (« éviter de rater un document
  important »), pas ses symptômes.
- Un cross-encoder est **beaucoup** plus précis qu'un cosinus : il voit la
  négation, les conditions, les quantificateurs (« *sans* convention »,
  « *après* la piscine »).
- Découple les deux objectifs : rappel à l'étage 1, précision à l'étage 2,
  chacun réglable indépendamment (fin des seuils qui font les deux à la fois).
- Le passage remplace le document dans le prompt ⇒ contexte plus dense, réponses
  mieux sourcées, latence de génération en baisse.

### Points faibles / risques

- **Le coût principal du document.** Un cross-encoder (BGE-reranker, mxbai)
  ajoute 0,2–0,5 s ; un LLM-reranker via le proxy, 2–3 s — sur un **GPU 42AI
  partagé**, et à ajouter aux ~2 s de la phase 1 déjà annoncées à l'utilisateur.
- Un modèle de plus à déployer/versionner sur l'hôte (ou une dépendance de plus
  au proxy Ollama).
- Le chunking est un art : mal découpé (au milieu d'un tableau, d'une liste de
  procédure), il **dégrade** le rappel. Les exports Notion ont déjà des quirks
  documentés.
- Ré-indexation complète obligatoire, et volumétrie du store à repenser.
- Un LLM-reranker peut halluciner un score ou casser son format JSON : il faut
  un fallback sur l'ordre dense.

### Usage habituel

Architecture **standard de tout RAG de production sérieux** depuis 2023 : Cohere
Rerank, BGE-reranker, ColBERT en variante « late interaction ». C'est ce que
recommandent LlamaIndex/LangChain par défaut, et ce que font les moteurs de
recherche web (rappel large BM25/ANN → ré-ordonnancement neuronal). Le chunking
de contenu est, lui, le mode *normal* de tout RAG — l'index de questions curatées
de Boby42 est en réalité une variante rare (« proxy indexing » / doc2query
manuel), excellente en précision, structurellement faible en rappel.

### Complémentarités

- **B + A** : essentielle. Le rerank tolère le bruit lexical, donc BM25 peut
  être agressif. C'est le pipeline recommandé.
- **B + C** : C multiplie les requêtes, B trie l'union — très bonne synergie,
  mais les latences s'additionnent (une seule des deux à la fois en prod).
- **B + D** : D limite le candidate set à un sous-domaine ⇒ moins de candidats
  à reranker ⇒ B redevient bon marché.
- **B rend `gateSubjectsPdf()` obsolète** : le reranker compare Notion et PDF sur
  une échelle unique et réelle.

---

## C. Transformation de la requête avant l'embedding

> **Recap.** Aujourd'hui la question part *telle quelle* dans l'embedder, une
> seule fois (§5.2 : « embeddé tel quel, sans pré-traitement »). Ici on insère une
> étape *avant* : un petit LLM réécrit la question en **plusieurs** variantes, la
> découpe si elle contient plusieurs intentions, et/ou génère une **réponse
> hypothétique** (HyDE) que l'on embedde à la place de la question. Chaque variante
> fait sa propre recherche, et on prend l'union.

### Schéma

```
   « jai perdu mon badge et je peux prendre la piscine en septembre ? »
                               │
                               ▼
        ┌──────────────────────────────────────────────────┐
        │  RÉÉCRITURE (LLM léger, ~1 s via le proxy)        │
        │                                                  │
        │  a) DÉCOMPOSITION multi-intention                 │
        │     → « badge perdu, que faire ? »                │
        │     → « inscription piscine septembre »           │
        │  b) PARAPHRASES / synonymes du domaine            │
        │     → « carte d'accès perdue 42 »                 │
        │  c) HyDE — réponse hypothétique inventée :        │
        │     « En cas de perte de badge, rendez-vous au    │
        │      bocal avec une pièce d'identité… »           │
        │      ⇒ un TEXTE DE DOC, pas une question          │
        └──────────────────────┬───────────────────────────┘
                               ▼
        embedding de CHAQUE variante (n = 3 à 5, en parallèle)
                               │
        ┌──────────┬───────────┼───────────┬──────────┐
        ▼          ▼           ▼           ▼          ▼
      rank       rank        rank        rank       rank        (pipeline actuel,
      store      store       store       store      store        inchangé)
        └──────────┴───────────┼───────────┴──────────┘
                               ▼
              UNION + dédoublonnage par document
              score(d) = max des scores obtenus  (ou RRF)
                               ▼
                     coupe MAX_DOCS → Phase 2
```

### Ce que ça change concrètement

- **Étape 1 seulement.** `generateEmbedding(question)` devient
  `expandQuery(question) → generateEmbedding × n` puis une agrégation. Toute la
  suite du pipeline (`rankStore`, gate, Phase 2) est **rigoureusement
  inchangée** — c'est la propriété la plus intéressante de cette approche.
- Aucune ré-indexation. Aucun nouveau store. Aucun nouveau modèle si on réutilise
  `mistral:latest` via `/ollama`.
- Le point de coupe reste le même, mais chaque document a désormais **n chances**
  de passer le seuil de 0.89.

### Pourquoi ça marche pour nous

Deux gains spécifiques au corpus 42 :

1. **L'asymétrie question ↔ index.** Le store contient des questions curatées et
   des mots-clés. Une question d'étudiant mal formulée, argotique ou tronquée
   (« la piscine c quand ») tombe loin de toute string curatée. Générer des
   paraphrases *dans le vocabulaire du corpus* ramène la requête sur le terrain
   de l'index. HyDE fait mieux encore : il transforme une question courte en un
   **texte ressemblant à un document**, ce qui recadre la comparaison.
2. **Le multi-intention.** Une question qui mélange administratif et projet ne
   peut pas gagner aujourd'hui : le `SCORE_MARGIN` de 0.01 garde le meilleur doc
   et jette l'autre intention. La décomposition la traite comme deux recherches
   séparées — et cela **contourne aussi** l'angle mort ⑤ (chaque sous-question
   arbitre son propre gate).

### Points forts

- **Le moins invasif de tous** : un seul point d'insertion, zéro ré-indexation,
  réversible par un flag.
- Améliore le rappel sans toucher aux seuils, donc sans risque de régression de
  précision sur les requêtes qui marchent déjà.
- Résout une classe d'échecs qu'aucune des autres approches ne traite : la
  question mal posée.
- Testable et mesurable immédiatement (le proxy `/ollama` est déjà en place).

### Points faibles / risques

- **Latence.** +1 à 3 s avant même de commencer à chercher, sur une phase 1
  vendue à ~2 s. Atténuations : n'expandre que si la première recherche revient
  vide ou faible (**fallback conditionnel** — recommandé), et paralléliser les
  n embeddings.
- **Dérive sémantique** : une reformulation peut inventer un terme absent du
  domaine et ramener un document hors-sujet avec un bon score. Le bruit
  augmente mécaniquement avec n.
- HyDE fait halluciner *volontairement* un texte : sur un corpus institutionnel
  (règles, dates, procédures), un contenu inventé peut orienter vers le mauvais
  document plausible.
- n appels d'embedding + 1 appel LLM par question = charge accrue sur le GPU
  partagé.

### Usage habituel

Multi-query et HyDE sont des briques standard de LlamaIndex / LangChain
(`MultiQueryRetriever`, `HyDEQueryTransform`). Très employées dans le support
client et les FAQ — exactement notre profil : utilisateurs non experts,
formulations libres, corpus rédigé dans un registre différent. Moins utilisées
là où les requêtes sont déjà normalisées (recherche interne d'ingénieurs,
requêtes structurées).

### Complémentarités

- **C + A** : excellente. Chaque variante interroge les deux canaux ; le lexical
  bénéficie beaucoup des synonymes générés.
- **C + B** : puissant mais **cumule les latences** — n'activer C que dans le
  fallback (« étage 1 pauvre ») si B est déjà en place.
- **C + D** : le routeur peut être produit par le *même* appel LLM que la
  réécriture (une seule requête qui renvoie `{intentions[], variantes[], route}`)
  — la latence de C est alors partagée avec D, ce qui la rend quasi gratuite.

---

## D. Routage par intention + index hiérarchique document → section

> **Recap.** Deux idées structurelles. (1) Remplacer `gateSubjectsPdf()` par un
> **routeur** explicite qui décide *où chercher* avant de chercher. (2) Indexer
> à deux niveaux — un vecteur « résumé » par document et des vecteurs par
> section — puis remonter du meilleur passage vers son document parent
> (*auto-merging retrieval*).

### Schéma

```
                              question
                                 │
                                 ▼
        ┌────────────────────────────────────────────────────┐
        │  ROUTEUR (classifieur léger ou 1 appel LLM)         │
        │  administratif / projet-cursus / vie-du-campus /     │
        │  ambigu                                             │
        │  sortie : { routes[], confiance }                   │
        │  ⚠ en cas de doute → TOUTES les routes (fail-open)   │
        └───────┬──────────────────────────┬─────────────────┘
                │                          │
    route=admin ▼                          ▼ route=projet
    ┌────────────────────┐        ┌────────────────────────┐
    │ store Notion       │        │ store SubjectsPdf      │
    │ budget: 5 docs     │        │ budget: 3 docs         │
    └─────────┬──────────┘        └───────────┬────────────┘
              └────────────┬──────────────────┘
                           ▼
        ┌──────────────────────────────────────────────────┐
        │  INDEX HIÉRARCHIQUE (par store)                   │
        │                                                   │
        │      NIVEAU 1 : vecteur « résumé du document »    │
        │        Wi-Fi ─── Bourses ─── Libft ─── …          │
        │          │                                        │
        │      NIVEAU 2 : vecteurs par section (## titres)  │
        │        ├─ « connexion eduroam »                    │
        │        ├─ « mot de passe oublié »                  │
        │        └─ « invités / visiteurs »                  │
        │                                                   │
        │  on cherche au NIVEAU 2 (précis, haut rappel)      │
        │  on renvoie le PARENT si ≥2 sections du même doc   │
        │  matchent (auto-merging) ; sinon la section seule  │
        └──────────────────────┬───────────────────────────┘
                               ▼
                 documents/sections → Phase 2
```

### Ce que ça change concrètement

- **Étape nouvelle 0.5** : le routage, en amont de tout.
- **Étape 4** : `gateSubjectsPdf()` — comparaison de scores non commensurables
  entre deux stores curatés différemment — est **supprimé** et remplacé par une
  décision sémantique explicite, journalisable et débuggable.
- **Phase 0** : le découpage par titres markdown (`##`) est presque gratuit sur
  des exports Notion, qui sont déjà structurés. Pour les PDF de sujets, la
  structure existe aussi (sections numérotées).
- **Budgets par route** : `MAX_DOCS` / `CHAT_MAX_SUBJECTS_PDF_DOCS` deviennent
  conditionnels à l'intention au lieu d'être des constantes globales.

### Pourquoi ça marche pour nous

Le problème que `gateSubjectsPdf()` résout — « ne pas coller des sujets ML sous
chaque question administrative » — est un problème de **routage**, traité
aujourd'hui par une comparaison de scores. Ces deux stores n'ont ni la même
densité de curation (1 377 strings Notion vs 4 475 PDF), ni la même longueur de
metaContexte, donc **leurs cosinus ne sont pas sur la même échelle** : la
comparaison `pdfBest >= notionBest` est structurellement fragile, et c'est
d'ailleurs assumé comme un stopgap dans `Retrieval_Plan.md`.

La hiérarchie, elle, traite un cas précis : les documents Notion longs et
multi-sujets. Aujourd'hui un doc est représenté par son **meilleur** vecteur ; un
document long qui traite marginalement du sujet peut battre un document court
entièrement dédié. Chercher au niveau section rétablit la granularité, et
l'auto-merging évite de perdre le contexte quand la réponse est étalée sur
plusieurs sections.

### Points forts

- Remplace une heuristique fragile par une décision **explicite, loggée,
  testable** — et donc améliorable.
- Réduit l'espace de recherche ⇒ moins de faux positifs *et* pipeline plus rapide
  (rend B abordable).
- Les budgets par intention permettent enfin des réponses à deux volets
  (« quel projet après la piscine et comment m'inscrire »).
- La granularité section améliore mécaniquement la qualité du prompt.

### Points faibles / risques

- **Le routeur est un point de défaillance unique** : une mauvaise route =
  document important **jamais consulté**, soit exactement le risque à éviter.
  Mitigation impérative : *fail-open* (en dessous d'un seuil de confiance, on
  interroge tout) — le routeur ne doit servir qu'à **prioriser**, jamais à
  exclure durement.
- Un classifieur d'intention se maintient (nouvelles catégories, dérive du
  vocabulaire étudiant) ; en version LLM, il ajoute un appel.
- Le découpage par titres suppose une structure markdown propre — vrai pour
  Notion, plus incertain pour le texte PDF brut (« marqueurs `-- N of M --`
  conservés »).
- Complexifie le modèle mental du pipeline : deux niveaux d'index + un aiguillage
  à débugger.

### Usage habituel

Le routage est la brique de base des **assistants multi-domaines** (support
produit A/B/C, RAG d'entreprise couvrant RH + IT + juridique) : LlamaIndex
`RouterQueryEngine`, LangGraph. Le retrieval hiérarchique / auto-merging /
parent-document est standard dès que les documents dépassent quelques pages
(documentation technique, rapports, contrats) et il est directement exposé dans
LangChain (`ParentDocumentRetriever`) et LlamaIndex (`AutoMergingRetriever`).

### Complémentarités

- **D + B** : très forte. D réduit le nombre de candidats, ce qui rend le rerank
  rapide et bon marché ; B fournit la granularité passage que D exploite.
- **D + C** : à fusionner en un seul appel LLM (routage + reformulation
  ensemble) — sinon on paie deux fois la même latence.
- **D + A** : le routeur peut choisir la pondération des canaux plutôt qu'un
  simple RRF uniforme.
- **D rend `gateSubjectsPdf()` et `SUBJECTS_PDF_SCORE_MARGIN` (0.10) inutiles.**

---

## 5. Matrice de complémentarité

```
        │   A hybride   │   B chunk+rerank │   C query-expand │   D routage+hiér.
────────┼───────────────┼──────────────────┼──────────────────┼──────────────────
   A    │       —       │ ★★★ canonique :  │ ★★ variantes ×   │ ★★ le routeur
        │               │ A rappelle,      │ 2 canaux, gros   │ pondère les
        │               │ B trie           │ gain lexical     │ canaux
────────┼───────────────┼──────────────────┼──────────────────┼──────────────────
   B    │      ★★★      │        —         │ ★ puissant mais  │ ★★★ D réduit le
        │               │                  │ latences cumulées│ set → B pas cher
────────┼───────────────┼──────────────────┼──────────────────┼──────────────────
   C    │      ★★       │        ★         │        —         │ ★★★ un seul appel
        │               │                  │                  │ LLM pour les deux
────────┼───────────────┼──────────────────┼──────────────────┼──────────────────
   D    │      ★★       │       ★★★        │       ★★★        │        —

   ★★★ synergie forte   ★★ bonne   ★ possible mais coûteux en latence
```

**Redondances à connaître :** A, B et D suppriment chacun le besoin de
`gateSubjectsPdf()`, pour des raisons différentes — inutile de les cumuler pour
ce seul motif. B et C augmentent tous deux le rappel « par le haut » : les
combiner donne des gains décroissants pour une latence additive.

---

## 6. Le préalable commun : sans mesure, aucune de ces approches n'est décidable

Les quatre approches déplacent des seuils et des ordres de tri. Aujourd'hui,
rien ne permet de dire si un changement améliore ou dégrade le rappel — les
réglages actuels (0.89 / 0.01 / 0.10) ont été trouvés à la main, requête par
requête.

```
  ┌────────────────────────────────────────────────────────────────┐
  │  JEU DE TEST  ~60–100 paires (question réelle → doc(s) attendu(s))│
  │  sources gratuites, déjà disponibles :                          │
  │   • les questions loggées en T4 (table des messages)            │
  │   • les 👎 et les commentaires de /feedback                     │
  │   • les événements no_match (déjà exposés par /analytics/unmatched)│
  └───────────────────────────┬────────────────────────────────────┘
                              ▼
  ┌────────────────────────────────────────────────────────────────┐
  │  MÉTRIQUES, dans cet ordre de priorité                          │
  │   1. recall@5   ← LA métrique : « a-t-on raté un doc ? »        │
  │   2. MRR / nDCG ← le bon doc est-il en tête ?                   │
  │   3. précision  ← combien de bruit dans le prompt               │
  │   4. latence p95 de la phase 1                                  │
  └────────────────────────────────────────────────────────────────┘

  Script offline, sans LLM : rejouer les N questions sur le retrieval seul.
  Rapide, déterministe, exécutable à chaque changement de constante.
```

Le pipeline actuel est déjà instrumenté pour ça (T4 + `/analytics`) — le jeu de
test est donc à portée de main, et c'est le prérequis le moins cher du document.

---

## 7. Séquencement recommandé

| Ordre | Quoi | Pourquoi d'abord | Effort |
|---|---|---|---|
| 0 | **Jeu de test + recall@5** (§6) | rend tout le reste mesurable ; peut révéler que le problème est ailleurs | S |
| 1 | **A — hybride BM25 + RRF** | meilleur gain/effort, zéro latence, zéro ré-indexation, supprime le gate | M |
| 2 | **B — chunking du contenu** (sans rerank d'abord) | attaque la cause racine ①, mesurable seul | L |
| 3 | **B — rerank** | ne se justifie qu'une fois le candidate set élargi par 1 et 2 | M |
| 4 | **C ou D** selon ce que le jeu de test révèle : questions mal formulées ⇒ **C** ; confusion admin/projet ⇒ **D** | ce sont des raffinements, pas des fondations | M |

**Le pari du document :** l'essentiel du rappel manquant vient de l'angle mort ①
(le contenu n'est pas indexé) et de l'angle mort ③ (un seul signal). A et B les
traitent ; C et D optimisent ensuite un pipeline déjà sain.
