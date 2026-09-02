# Retrieval_Plan.md — Pipeline de récupération & sélection des documents

> Schéma d'exécution exhaustif du RAG de Boby 42 : de la question de
> l'étudiant jusqu'aux documents injectés dans le prompt du LLM.
> Deux chemins distincts coexistent : **`/chat`** (2 phases, ranké + coupé)
> et **`/archiviste`** (1 phase, scan brut file-order). Ils ne partagent
> plus que l'embedding de la question et les constantes `MIN_SCORE` / `MAX_DOCS`.
>
> Fichiers concernés :
> `backend/services/retriever.service.js` · `backend/services/orchestrator.service.js`
> `backend/services/ollama.service.js` · `backend/lib/cosine.js`
> `backend/routes/chat.js` · `backend/routes/chatDocuments.js` · `backend/routes/archiviste.js`
> `backend/services/subjectsPdfText.service.js` · `backend/services/documentReader.service.js`
> `backend/services/subjectsPdfLibrary.service.js`
> `backend/scripts/generateVectorStore.js` · `backend/scripts/generateSubjectsPdfVectorStore.js`

---

## 0. Vue d'ensemble

```
                        ┌──────────────────────────────────────────┐
                        │  PHASE 0 — INDEXATION (hors ligne)        │
                        │  make vectorStore / subjectsPdfVectorStore│
                        └──────────────────────────────────────────┘
                                          │  produit
                                          ▼
                 data/vector_store.json  +  data/subjectsPdf_vector_store.json
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
        │                                 │                                 │
        ▼                                 ▼                                 ▼
┌───────────────┐            ┌────────────────────────┐         ┌────────────────────┐
│  /archiviste  │            │  /chat  PHASE 1        │         │  /chat  PHASE 2    │
│  1 appel      │            │  POST /chat/documents  │ ──rows──▶│  POST /chat        │
│  scan brut    │            │  retrieval seul, ~2 s  │         │  génération LLM    │
└───────────────┘            └────────────────────────┘         └────────────────────┘
```

- **Phase 0** : les questions/mots-clés curatés (`claudeQuestions.json`,
  `subjectsPdfQuestions.json`) sont embeddés une fois et stockés dans deux
  fichiers JSON committés. Aucune ré-indexation à l'exécution.
- **`/chat`** est un flux en **deux appels HTTP** derrière un seul
  `AbortController` côté front : d'abord la récupération (rapide, sans LLM),
  puis la génération sur les lignes renvoyées.
- **`/archiviste`** fait tout en **un seul appel**, sans LLM, avec l'ancien
  algorithme de scan (volontairement inchangé = liste longue et bruitée).

---

## 1. PHASE 0 — Indexation (build-time)

```
data/claudeQuestions.json                     data/subjectsPdfQuestions.json
  { documents: [                                { documents: [
    { filename: "/data/documents/Notion/X.md",     { filename: "/data/SubjectsPdf/Cat/Y.pdf",
      metaContexte: [ "question 1",                  metaContexte: [ "libft", "libft authorized",
                      "cafétéria", "TIG",                            "c'est quoi le projet libft", ... ]
                      "résumé de section", ... ] }  } ] }
  ] }
        │                                                   │
        ▼   scripts/generateVectorStore.js                  ▼  scripts/generateSubjectsPdfVectorStore.js
┌─────────────────────────────────────────────────────────────────────────────┐
│ POUR CHAQUE doc :                                                            │
│   POUR CHAQUE string de metaContexte[] :                                     │
│     embedding = POST {OLLAMA_BASE_URL}/api/embeddings                        │
│                 { model: OLLAMA_EMBEDDING_MODEL, prompt: string }            │
│     embedding = arrondi à EMBEDDING_PRECISION (6) décimales                  │
│     embeddings.push(embedding) ; texts.push(string)   ← même boucle,         │
│                                                        indices alignés       │
│ store.push({ filename, embeddings: number[][], texts: string[] })            │
└─────────────────────────────────────────────────────────────────────────────┘
        │                                                   │
        ▼                                                   ▼
data/vector_store.json                        data/subjectsPdf_vector_store.json
  [ { filename, embeddings[][], texts[] }, ... ]   (même forme)
  écrit compact (JSON.stringify sans indentation)
```

**Notes structurantes :**

- Un document a **autant de vecteurs que de strings curatées** (souvent des
  dizaines). `texts[i]` est *par construction* la string qui a produit
  `embeddings[i]` — une seule boucle écrit les deux, ils ne peuvent pas
  diverger. Ne jamais reconstruire `texts` en zippant le fichier questions
  sur un store existant.
- Les strings courtes (`"wifi"`, `"RNCP"`, `"cafétéria"`, `"TIG"`) sont
  **volontaires** : elles font passer certaines requêtes d'un score 1.000 à
  « zéro résultat » si on les supprime. Ne pas « nettoyer ».
- `EMBEDDING_PRECISION = 6` : arrondi mesuré inoffensif (cosinus plein vs
  arrondi = 0.999999999957) et indispensable pour rester sous la limite
  100 MB de GitHub (store PDF : 138.7 MB → 43.3 MB ; Notion : 42.7 → 13.4 MB).
- Modèle : `OLLAMA_EMBEDDING_MODEL` = `snowflake-arctic-embed:335m`,
  1024 dimensions. Mélanger les modèles casse les scores.

---

## 2. CHEMIN `/chat` — PHASE 1 : récupération (`POST /chat/documents`)

`routes/chatDocuments.js` → `retriever.service.js :: retrieveUnified(question, language)`

```
question (string)  +  language ∈ {fr,en,origin}  (défaut 'fr')
        │
        ▼
┌─ ÉTAPE 1 — Embedding de la question ────────────────────────────────────────┐
│  queryEmbedding = generateEmbedding(question)                               │
│    → POST {OLLAMA_BASE_URL}/api/embeddings {model: OLLAMA_EMBEDDING_MODEL}  │
│    → number[1024]                                                          │
└───────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ ÉTAPE 2 — Chargement des deux stores (en parallèle, Promise.all) ─────────┐
│  notionRaw       = fs.readFile(data/vector_store.json)          → JSON.parse │
│  subjectsPdfRaw  = fs.readFile(data/subjectsPdf_vector_store.json) → JSON.parse│
│  (coût dominant : ~0.34 s de JSON.parse sur le store Notion)               │
└───────────────────────────────────────────────────────────────────────────┘
        │
        ├──────────────────────────────┐
        ▼                              ▼
┌─ ÉTAPE 3a — rankStore(NOTION) ─┐   ┌─ ÉTAPE 3b — rankStore(PDF) ───────────┐
│ options:                       │   │ options:                              │
│   minScore = MIN_SCORE (0.89)  │   │   minScore = SUBJECTS_PDF_MIN_SCORE    │
│   maxDocs  = MAX_DOCS  (5)      │   │              (0.89)                   │
│   margin   = SCORE_MARGIN(0.01) │   │   maxDocs  = CHAT_MAX_SUBJECTS_PDF_DOCS│
│                                │   │              (3)                      │
│ POUR CHAQUE doc du store :      │   │   margin   = SUBJECTS_PDF_SCORE_MARGIN │
│   best = max( cosine(q, e) )    │   │              (0.10)                   │
│          sur TOUS ses embeddings│   │ (même algorithme que 3a)             │
│   si best >= minScore :         │   └──────────────────────────────────────┘
│     scored.push({filename,best})│                    │
│ si scored vide → []             │                    │
│ scored.sort( best DESC )        │                    │
│ cutoff = scored[0].best - margin│                    │
│ garder score >= cutoff          │                    │
│ puis .slice(0, maxDocs)         │                    │
└────────────────────────────────┘                    │
        │  notionSelected [{filename,score}]           │  pdfSelectedRaw [{filename,score}]
        │                                              ▼
        │              ┌─ ÉTAPE 4 — gateSubjectsPdf(notionSelected, pdfSelectedRaw) ─┐
        │              │  si pdfSelectedRaw vide            → []                      │
        │              │  notionBest = notionSelected[0]?.score ?? 0                 │
        │              │  si pdfSelectedRaw[0].score >= notionBest → pdfSelectedRaw  │
        │              │  sinon                                    → []              │
        │              │  (= "on ne montre les PDF sujets que s'ils battent le       │
        │              │     meilleur résultat Notion ; toujours si Notion vide")    │
        │              └────────────────────────────────────────────────────────────┘
        │                                              │  subjectsPdfSelected
        ▼                                              ▼
┌─ ÉTAPE 5 — Construction des lignes d'affichage ───────────────────────────┐
│  notionRows = notionSelected.map →                                        │
│    { name: basename sans .md,                                             │
│      score,                                                              │
│      type: 'md',                                                         │
│      url: `/BaseDocumentaire/${language}/Notion/${encodeURIComponent(name)}.md` }│
│  pdfRows = subjectsPdfSelected.map →                                      │
│    { name: basename sans .pdf,                                           │
│      score,                                                             │
│      type: 'pdf',                                                       │
│      url: `/subjectspdf/${encodeURIComponent(basename)}` }              │
│  documents = [ ...notionRows, ...pdfRows ]   (Notion d'abord)            │
└──────────────────────────────────────────────────────────────────────────┘
        │
        ▼
  { count: documents.length, documents }        ← AUCUN fichier lu ici
                                                  (ni .md, ni .pdf)
```

**Points clés Phase 1 :**

- `rankStore()` est **pure** (reçoit le store déjà parsé) et **exhaustive**
  (teste tous les embeddings de tous les docs — l'early-exit historique ne
  gagnait rien de mesurable).
- Ordre des opérations rankStore : **best-score par doc → plancher `minScore`
  → tri décroissant → coupe `margin` depuis le meilleur → cap `maxDocs`**.
- Un résultat vide reste `[]` (le fallback « aucun document » de la Phase 2 en
  dépend).
- `language` **n'influence pas la récupération** — il ne sert qu'à fabriquer
  l'URL Notion.
- `retrieveUnified()` ne lit **aucun** `.md` : la lecture du contenu par
  langue est faite en Phase 2.

---

## 3. CHEMIN `/chat` — PHASE 2 : génération (`POST /chat`)

`routes/chat.js` → `orchestrator.service.js :: getAnswer(question, documents, language, {onToken, signal})`

```
question  +  documents? (les rows de la Phase 1, max 10, renvoyées par le front)
          +  language (défaut 'fr')  +  stream? (bool)
        │
        ▼
┌─ ÉTAPE 1 — Source des lignes ───────────────────────────────────────────────┐
│  if (documents == null)                                                     │
│     rows = retrieveUnified(question, lang).documents   ← fallback 1 appel    │
│  else                                                                       │
│     rows = documents                                   ← cas normal (2 appels)│
└────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ ÉTAPE 2 — loadDocuments(rows, language) : résolution + lecture ────────────┐
│  POUR CHAQUE row :                                                          │
│   ├─ type 'md' :                                                            │
│   │    doc = readBaseDocumentaireDocument(language, `${name}.md`)           │
│   │          → whitelist via fs.readdir du dossier résolu                   │
│   │            (fr→BaseDocumentaire/Fr, en→/En, origin→documents/Notion)    │
│   │    si non résolu → console.warn + DROP (pas d'erreur)                   │
│   │    path = <dossier langue>/<name>.md                                    │
│   │    content = contenu markdown brut                                      │
│   └─ type 'pdf' :                                                           │
│        pdfPath = resolveSubjectsPdfFile(`${name}.pdf`)                      │
│                  → scan récursif de data/SubjectsPdf/, match par basename   │
│        si non résolu → console.warn + DROP                                  │
│        content = readSubjectsPdfText(pdfPath)                              │
│                  → pdf-parse (API PDFParse v2), mémoïsé dans une Map        │
│                    par chemin absolu, JAMAIS évincé                        │
│                  → NE LÈVE JAMAIS : PDF cassé ⇒ warn + content = null      │
│  → loaded [{ name, type, url, path, score, content|null }]                  │
└────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ ÉTAPE 3 — selectPromptDocuments(loaded) : quel texte entre dans le prompt ─┐
│  mdRows  = loaded.filter(type 'md'  && content).sort(score DESC)           │
│  pdfRows = loaded.filter(type 'pdf' && content).sort(score DESC)           │
│  budget partagé  used = 0 ,  plafond = MAX_CONTEXT_CHARS (24 000)           │
│                                                                            │
│  pdfCap = (mdRows.length === 0 && pdfRows.length === 1)                     │
│             ? MAX_CONTEXT_CHARS          ← sujet SEUL : tout le budget       │
│             : MAX_CHARS_PER_PDF (8 000)                                     │
│                                                                            │
│  PASSE 1 (md)  : pour chaque mdRow                                          │
│     part = min( MAX_CHARS_PER_DOC (15 000) , MAX_CONTEXT_CHARS - used )     │
│     si part <= 0 : break                                                   │
│     text = content.slice(0, part)  (+ "\n\n[...]" si tronqué)              │
│     used += longueur du slice                                             │
│  PASSE 2 (pdf)  : idem avec pdfCap                                          │
│                                                                            │
│  → promptDocuments [{ name, type, text }]   (Notion prioritaire)           │
└────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ ÉTAPE 4 — Garde « aucun document » ──────────────────────────────────────┐
│  if (promptDocuments.length === 0)                                         │
│     return { answer: NO_DOCUMENTS_ANSWER (texte figé), sources: [] }       │
│     → AUCUN appel Ollama                                                   │
│  (couvre : toutes les lignes md non résolues ET toutes les extractions     │
│   PDF nulles, ou résultat PDF-only sans texte extractible)                 │
└──────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ ÉTAPE 5 — buildPrompt(question, promptDocuments) ────────────────────────┐
│  context = promptDocuments                                                │
│    .map(d => `--- Document : ${d.name} ---\n${d.text}`).join("\n\n")      │
│  prompt  = gabarit figé « Tu es Boby42… » + === DOCUMENTS TROUVÉS === +    │
│            context + QUESTION + 7 RÈGLES + "RÉPONSE :"                     │
│  (log info : `[orchestrator] prompt documents (N chars): <noms>`)         │
└──────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ ÉTAPE 6 — generateAnswer(prompt, {}, {onToken, signal}) ─────────────────┐
│  POST {OLLAMA_BASE_URL}/api/generate                                       │
│    { model: OLLAMA_GENERATION_MODEL,                                       │
│      prompt,                                                               │
│      stream: (onToken fourni ? true : false),                             │
│      options: { ...GENERATION_OPTIONS, ...{} } }                          │
│  GENERATION_OPTIONS = { num_ctx: 16384, temperature: 0.2,                 │
│                         num_predict: 600 }                                │
│  stream true  → NDJSON ligne à ligne, onToken(fragment) par fragment,      │
│                 réponse complète quand même assemblée et renvoyée          │
│  signal       → AbortSignal câblé sur la fermeture de la socket réponse    │
│                 (client parti ⇒ on stoppe Ollama sur le GPU partagé)       │
└──────────────────────────────────────────────────────────────────────────┘
        │
        ▼
  answer = réponse.trim()
  sources = loaded.map({ name, type, url, path, score })   ← LISTE COMPLÈTE
            (pas la tranche coupée ; c'est ce qui est loggé T4 + renvoyé)
        │
        ▼
  { answer, sources, conversationId, messageId }
  (+ persistance T4 ; + event 'no_match' si sources.length === 0)
```

---

## 4. CHEMIN `/archiviste` (`POST /archiviste`) — inchangé par design

`routes/archiviste.js` → `retriever.service.js :: retrieveWithSubjectsPdf(question)`

```
question  +  language (REQUIS ici)
        │
        ▼
  queryEmbedding = generateEmbedding(question)     (1 seul embedding)
        │
        ├───────────────────────────────┐
        ▼                               ▼
┌─ searchVectorStore(NOTION) ──┐   ┌─ searchSubjectsPdfStore(PDF) ───────┐
│ scan dans l'ORDRE DU FICHIER │   │ même algo, autres constantes :      │
│ POUR CHAQUE doc :            │   │   seuil = SUBJECTS_PDF_MIN_SCORE     │
│  POUR CHAQUE embedding :     │   │           (0.89)                    │
│   score = cosine(q, e)       │   │   arrêt  = MAX_SUBJECTS_PDF_DOCS (3) │
│   si score >= MIN_SCORE(0.89)│   └─────────────────────────────────────┘
│     → push {filename, score} │              │
│       BREAK (1er au-dessus   │              │
│       du seuil, PAS le best) │              │
│  si selected.length>=MAX_DOCS│              │
│     (5) → BREAK boucle docs  │              │
└──────────────────────────────┘              │
        │  notionSelected                     │  subjectsPdfSelected
        ▼                                     │
  readDocuments(notionSelected) :             │
    pour chaque → resolveDocumentPath()       │
      = data/documents/Notion/<basename>      │
      (langue-agnostique, TOUJOURS ce dossier)│
    fs.readFile ; ENOENT → drop SILENCIEUX    │
        │                                     │
        ▼                                     ▼
  { documents: [{name,path,score,content}], subjectsPdf: [{filename,score}] }
        │
        ▼  (dans routes/archiviste.js)
  notionResults = map → { name sans .md, score, type:'md',
                          url:/BaseDocumentaire/${language}/Notion/… }
  pdfResults    = map → { name sans .pdf, score, type:'pdf',
                          url:/subjectspdf/<basename> }
  documents = [ ...notionResults, ...pdfResults ]
        │
        ▼
  { count, documents, conversationId, messageId }
  (PAS de rankStore, PAS de coupe margin, PAS de gate PDF,
   PAS de LLM, PAS de lecture PDF)
```

**Différence structurelle `/chat` vs `/archiviste` :**

| Aspect | `/chat` (`retrieveUnified`) | `/archiviste` (`retrieveWithSubjectsPdf`) |
|---|---|---|
| Score retenu par doc | **meilleur** embedding (`rankStore`) | **1er** embedding au-dessus du seuil (scan) |
| Ordre de parcours | tri global par score | ordre du fichier (early-exit) |
| Coupe relative | oui — `SCORE_MARGIN` / `SUBJECTS_PDF_SCORE_MARGIN` | non |
| Gate PDF vs Notion | oui — `gateSubjectsPdf()` | non (les 2 stores fusionnés bruts) |
| Budget PDF | `CHAT_MAX_SUBJECTS_PDF_DOCS` (3) | `MAX_SUBJECTS_PDF_DOCS` (3) |
| LLM | oui (Phase 2) | non |
| Lecture contenu | Phase 2, par langue + extraction PDF | `.md` seulement, dossier `origin` |
| Résultat typique | 1–2 documents | liste longue (jusqu'à 5 + 3) |

---

## 5. Variables d'ajustement — par étape

### 5.1 Étape indexation (Phase 0)

| Variable | Lieu | Valeur | Effet sur la pipeline |
|---|---|---|---|
| `OLLAMA_EMBEDDING_MODEL` | env (`ollama.service.js`) | `snowflake-arctic-embed:335m` (1024 d) | Modèle qui produit **tous** les vecteurs (store + question). Le changer oblige à **tout ré-indexer** ; mélanger deux modèles rend les cosinus incohérents. |
| `OLLAMA_BASE_URL` | env | `http://localhost:11434` (prod) | Cible des appels `/api/embeddings` et `/api/generate`. |
| `EMBEDDING_PRECISION` | les 2 scripts `generate*VectorStore.js` | `6` | Décimales conservées par vecteur. ↓ = fichiers plus petits, risque théorique sur le cosinus (mesuré négligeable à 6). ↑ = fichiers > 100 MB rejetés par GitHub. |
| Contenu de `metaContexte[]` | `claudeQuestions.json`, `subjectsPdfQuestions.json` | ~1 377 strings Notion / ~4 475 PDF | **Le vrai levier de rappel.** Chaque string = 1 vecteur. Mélange voulu questions + résumés + titre + mots-clés bruts. Supprimer les courts casse `wifi`/`alternance`/`rncp`/`badge perdu`. |
| Ajout d'un document | 3 endroits + rebuild | — | `documents/Notion/` + entrée `claudeQuestions.json` + `make vectorStore` ; et les copies `BaseDocumentaire/Fr` + `/En`. Pour un PDF : `SubjectsPdf/<Cat>/` + entrée `subjectsPdfQuestions.json` + `make subjectsPdfVectorStore`. |

### 5.2 Étape embedding de la question (Phase 1 & `/archiviste`)

| Variable | Lieu | Effet |
|---|---|---|
| `OLLAMA_EMBEDDING_MODEL` / `OLLAMA_BASE_URL` | env | idem ci-dessus — doit être le **même modèle** qu'à l'indexation. |
| `question` (texte brut) | corps de requête | Embeddé tel quel, **sans pré-traitement** (pas de lower-case, pas de nettoyage). |

### 5.3 Étape ranking / sélection Notion — `/chat` (`rankStore`, ÉTAPE 3a)

| Variable | Lieu | Valeur | Effet |
|---|---|---|---|
| `MIN_SCORE` | `retriever.service.js` | `0.89` | **Plancher absolu** : cosinus (meilleur embedding du doc) sous ce seuil ⇒ doc éliminé. Décide *si quelque chose a matché*. ↑ = plus strict, risque 0 résultat ; ↓ = plus de bruit. |
| `SCORE_MARGIN` | `retriever.service.js` | `0.01` | **Coupe relative** : après tri, on jette tout ce qui est à plus de `margin` sous le meilleur score. C'est ce qui fait passer « délégués » de 32 docs à 1. `0.02` réadmet du bruit (mesuré, rejeté) ; `0.00` ne garderait que les ex-æquo stricts du top. |
| `MAX_DOCS` | `retriever.service.js` | `5` | **Cap dur** après la coupe. Rarement atteint depuis `SCORE_MARGIN`. Sert aussi de garde-fou. |

### 5.4 Étape ranking / sélection PDF sujets — `/chat` (`rankStore` + `gateSubjectsPdf`, ÉTAPES 3b & 4)

| Variable | Lieu | Valeur | Effet |
|---|---|---|---|
| `SUBJECTS_PDF_MIN_SCORE` | `retriever.service.js` | `0.89` | Plancher du store PDF (constante distincte de `MIN_SCORE`, même valeur pour l'instant, libre de diverger). |
| `SUBJECTS_PDF_SCORE_MARGIN` | `retriever.service.js` | `0.10` | Coupe relative du store PDF — **10× plus large** que côté Notion, **volontairement**. Les métadonnées PDF contiennent le nom exact du projet ⇒ une requête « Machine learning » matche une string à 1.000 et une marge serrée écraserait les vrais modules ML. `0.05` insuffisant, `0.15` identique à `0.10` (le cap borne avant). |
| `CHAT_MAX_SUBJECTS_PDF_DOCS` | `retriever.service.js` | `3` | Cap du nombre de PDF sujets renvoyés par `/chat` (distinct de `MAX_SUBJECTS_PDF_DOCS`). |
| `gateSubjectsPdf()` (logique, pas une constante) | `retriever.service.js` | — | Garde binaire : les lignes PDF ne sont montrées **que si** `pdfBest >= notionBest` (donc toujours si Notion est vide). Stopgap tant que le store PDF est à moitié curaté. Pour désactiver : renvoyer `pdfSelected` inconditionnellement. |

### 5.5 Étape scan brut — `/archiviste` (`searchVectorStore` / `searchSubjectsPdfStore`)

| Variable | Lieu | Valeur | Effet |
|---|---|---|---|
| `MIN_SCORE` | `retriever.service.js` | `0.89` | Seuil du **premier** embedding qui fait garder le doc (le score enregistré est celui-là, pas le meilleur). |
| `MAX_DOCS` | `retriever.service.js` | `5` | Nombre de docs Notion après lequel le scan s'arrête (early-exit dans l'ordre du fichier). |
| `MAX_SUBJECTS_PDF_DOCS` | `retriever.service.js` | `3` | Idem pour le store PDF sur `/archiviste` (non gaté). |
| Ordre des entrées dans `vector_store.json` | fichier généré | — | **Influence le résultat** sur `/archiviste` : early-exit ⇒ un doc plus haut dans le fichier avec un match « suffisant » gagne sur un doc plus bas mieux scoré. (Aucun effet sur `/chat` qui trie globalement.) |

### 5.6 Étape résolution + lecture — `/chat` Phase 2 (`loadDocuments`)

| Variable | Lieu | Effet |
|---|---|---|
| `language` (`fr` \| `en` \| `origin`) | corps `POST /chat` (défaut `fr`) | Choisit le dossier lu pour les `.md` : `BaseDocumentaire/Fr/Notion`, `/En/Notion`, ou `documents/Notion` (origin). **Aucun effet sur la récupération.** |
| Whitelist `fs.readdir` | `documentReader.service.js` | Un nom qui n'existe pas dans le dossier résolu ⇒ ligne **droppée** (`console.warn`), jamais d'erreur. Défense path-traversal. |
| Index basename récursif | `subjectsPdfLibrary.service.js` | Résout `<name>.pdf` par `path.basename` sur tout `SubjectsPdf/`. Suppose les basenames uniques entre catégories. |
| Cache `Map` (mémoïsation PDF) | `subjectsPdfText.service.js` | Texte extrait mis en cache **par chemin absolu, jamais évincé**. Redémarrage conteneur = cache vidé. Extraction ratée ⇒ `content = null` (jamais d'exception). |
| Lib `pdf-parse` (API `PDFParse` v2) | `subjectsPdfText.service.js` | Texte pris **brut** : pas de nettoyage, pas de reflow, marqueurs `-- N of M --` conservés (~1.7 % du corpus). |

### 5.7 Étape sélection du texte du prompt — `/chat` Phase 2 (`selectPromptDocuments`)

| Variable | Lieu | Valeur | Effet |
|---|---|---|---|
| `MAX_CONTEXT_CHARS` | `orchestrator.service.js` | `24000` | **Budget total** de caractères de documents dans le prompt, partagé md + pdf. ≈ 8 000 tokens ≈ moitié de la fenêtre. **C'est le cadran de latence** : le diviser par 2 ≈ diviser l'attente par 2. |
| `MAX_CHARS_PER_DOC` | `orchestrator.service.js` | `15000` | Plafond par document **Notion**. Passe 1. Un doc coupé reçoit un suffixe `\n\n[...]`. |
| `MAX_CHARS_PER_PDF` | `orchestrator.service.js` | `8000` | Plafond par **PDF sujet**. Passe 2 (après les md). Choisi pour que 3 sujets tiennent dans la fenêtre 16 384 tokens (sinon troncature **silencieuse** d'Ollama). |
| Exception « sujet seul » | `orchestrator.service.js` (logique) | — | Si `mdRows.length === 0 && pdfRows.length === 1` ⇒ le PDF reçoit **tout** `MAX_CONTEXT_CHARS` au lieu de `MAX_CHARS_PER_PDF`. Réponses « c'est quoi ce projet » plus riches. |
| Ordre des passes (md puis pdf) | `orchestrator.service.js` | — | Les documents Notion sont **servis en premier** ; un sujet ne prend que ce qui reste du budget. |
| Tri par `score` desc dans chaque passe | `orchestrator.service.js` | — | Garantit que le meilleur match entre en premier même si le client renvoie `documents` dans le désordre. |

### 5.8 Étape garde « aucun document » — `/chat` Phase 2

| Variable | Lieu | Effet |
|---|---|---|
| Condition `promptDocuments.length === 0` | `orchestrator.service.js` | Déclenche le retour de `NO_DOCUMENTS_ANSWER` **sans appel Ollama**. Couvre : toutes les lignes md non résolues ET toutes les extractions PDF nulles. |
| `NO_DOCUMENTS_ANSWER` | `orchestrator.service.js` | Texte figé (faute d'orthographe incluse — **ne pas toucher**) renvoyé avec `sources: []`. |

### 5.9 Étape génération LLM — `/chat` Phase 2 (`generateAnswer`)

| Variable | Lieu | Valeur | Effet |
|---|---|---|---|
| `OLLAMA_GENERATION_MODEL` | env | `mistral:latest` (prod) | Modèle de génération. |
| `GENERATION_OPTIONS.num_ctx` | `ollama.service.js` | `16384` | **Fenêtre de contexte forcée.** Le Modelfile de `mistral:latest` n'en fixe aucune ⇒ sans ça, valeur par défaut de l'hôte (2 048 sur vieux Ollama) et prompt trop long **tronqué silencieusement**. |
| `GENERATION_OPTIONS.temperature` | `ollama.service.js` | `0.2` | Basse : recherche documentaire, pas de créativité. |
| `GENERATION_OPTIONS.num_predict` | `ollama.service.js` | `600` | Borne max de tokens générés (réponses testées < 200). |
| `options` (2ᵉ arg de `generateAnswer`) | appelant | `{}` depuis l'orchestrateur | Fusionné par-dessus `GENERATION_OPTIONS` pour override par appel. L'orchestrateur n'en passe aucun ; les scripts de test via `/ollama` peuvent tout faire varier. |
| `onToken` | `routes/chat.js` | fourni si `stream: true` | Bascule l'appel en `stream: true` (NDJSON), émet chaque fragment. Réponse complète quand même assemblée. |
| `signal` (`AbortSignal`) | `routes/chat.js` | câblé sur `raw.on('close')` | Le client se déconnecte ⇒ `ac.abort()` ⇒ fetch Ollama annulé (libère le GPU partagé). |
| Gabarit de `buildPrompt` (7 règles, cadrage « Boby42 documentaliste ») | `orchestrator.service.js` | — | Modifie fortement la forme de la réponse : ≤ 8 phrases, pas de titres/tableaux, citations `[Nom]`, langue de la question, ignorer en silence les docs hors-sujet. En-tête unique `--- Document : <nom> ---` pour md et pdf (un en-tête PDF distinct a été mesuré pire). |

### 5.10 Paramètres de requête (contrat HTTP) qui pilotent la pipeline

| Champ | Endpoint | Défaut | Effet |
|---|---|---|---|
| `question` | tous | requis | Texte embeddé. |
| `language` | `/chat`, `/chat/documents`, `/archiviste` | `fr` (requis sur `/archiviste`) | URL Notion + (Phase 2) dossier de langue lu. Jamais utilisé pour la récupération. |
| `documents` | `POST /chat` | absent ⇒ fallback retrieval interne | Les lignes de Phase 1 renvoyées par le front (max 10). Présent ⇒ **pas de 2ᵉ embedding**, on relit exactement ces noms via les whitelists (le `url` de la requête n'ouvre **jamais** rien). |
| `stream` | `POST /chat` | `false` | `true` ⇒ réponse NDJSON token par token ; sinon un seul corps JSON. |
| `visitorId`, `conversationId` | tous | optionnels | Journalisation T4 uniquement — aucun effet sur la sélection des documents. |

---

## 6. Constantes — récapitulatif par fichier

**`backend/services/retriever.service.js`**
```
MAX_DOCS                    = 5      // cap docs Notion (les 2 chemins)
MIN_SCORE                   = 0.89   // plancher cosinus Notion (les 2 chemins)
MAX_SUBJECTS_PDF_DOCS       = 3      // cap PDF — /archiviste (non gaté)
SUBJECTS_PDF_MIN_SCORE      = 0.89   // plancher cosinus PDF
SCORE_MARGIN               = 0.01   // coupe relative Notion — /chat seulement
SUBJECTS_PDF_SCORE_MARGIN  = 0.10   // coupe relative PDF — /chat seulement
CHAT_MAX_SUBJECTS_PDF_DOCS  = 3      // cap PDF — /chat (gaté)
```

**`backend/services/orchestrator.service.js`**
```
MAX_CONTEXT_CHARS  = 24000   // budget total texte docs dans le prompt (cadran latence)
MAX_CHARS_PER_DOC  = 15000   // plafond par doc Notion
MAX_CHARS_PER_PDF  = 8000    // plafond par PDF sujet (sauf "sujet seul" ⇒ budget entier)
NO_DOCUMENTS_ANSWER = "…"    // texte figé, aucun appel Ollama
```

**`backend/services/ollama.service.js`**
```
GENERATION_OPTIONS = { num_ctx: 16384, temperature: 0.2, num_predict: 600 }
```

**`backend/scripts/generate*VectorStore.js`**
```
EMBEDDING_PRECISION = 6      // décimales par vecteur stocké
```

**Variables d'environnement**
```
OLLAMA_BASE_URL          // cible Ollama (embeddings + génération)
OLLAMA_EMBEDDING_MODEL   // snowflake-arctic-embed:335m (1024 d) — doit être identique store/requête
OLLAMA_GENERATION_MODEL  // mistral:latest
```

---

## 7. Invariants à ne pas casser

1. **`rankStore()` reste pure** (reçoit le store parsé) — testable sans Ollama ni FS.
2. **`retrieveUnified()` ne lit aucun `.md`** — la lecture par langue est en Phase 2.
3. **Les entrées du store PDF ne doivent jamais atteindre `resolveDocumentPath()` / `readDocuments()`** : elles résoudraient vers `documents/Notion/<name>.pdf`, échoueraient, et disparaîtraient **silencieusement** (ENOENT avalé).
4. **`texts[i]` ↔ `embeddings[i]`** : une seule boucle les écrit. Ne jamais reconstruire `texts` par zip.
5. **Un résultat de récupération vide reste `[]`** — le fallback « aucun document » en dépend.
6. **`num_ctx` explicite obligatoire** — sinon troncature silencieuse du prompt.
7. **Le scan file-order de `/archiviste` est intouché volontairement** — ne pas y propager le ranking de `/chat` sans décision explicite.
```
