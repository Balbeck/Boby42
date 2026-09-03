/**
 * @typedef {Object} Exchange
 * @property {string} id
 * @property {string} question
 * @property {string} answer
 * @property {ArchivisteDocument[]} documents - lignes trouvées par POST /chat/documents (phase 1), rendues comme sur /archiviste ; chargées paresseusement au dépli
 * @property {'retrieving' | 'reading' | 'done' | 'error'} phase - étape du flux à deux appels : 'retrieving' (phase 1), 'reading' (phase 2 en cours), 'done', 'error'
 * @property {boolean} loading
 * @property {string} [error] - message d'erreur brut ; le préfixe traduit est ajouté à l'affichage
 * @property {string | null} [messageId] - id du message assistant renvoyé par /chat ; handle pour /feedback (null tant que la réponse n'est pas revenue)
 * @property {-1 | 0 | 1} [rating] - note courante de la réponse (0 = pas de note) ; optimiste, rollback silencieux si l'envoi échoue
 */

/**
 * @typedef {Object} Source
 * @property {string} name - sans extension .md / .pdf (convention archiviste, depuis L1)
 * @property {'md' | 'pdf'} [type]
 * @property {string} [url] - route de prévisualisation
 * @property {string} path
 * @property {number} score
 */

/**
 * @typedef {Object} ChatResponse
 * @property {string} answer
 * @property {Source[]} sources - documents retenus par le prompt ; transmis à dessein alors qu'aucun appelant ne le lit (les documents affichés viennent de la phase 1), gardé comme handle pour un futur rapprochement affiché/utilisé
 * @property {string} [conversationId] - conversation à laquelle l'échange a été rattaché (T4) ; le hook le renvoie à la question suivante
 * @property {string} [messageId] - id du message assistant ; handle pour /feedback (absent si l'écriture de log a échoué)
 */

/**
 * @typedef {Object} ArchivisteDocument
 * @property {string} name
 * @property {number} score
 * @property {'md' | 'pdf'} type - 'md' → contenu markdown fetché en JSON ; 'pdf' → affiché tel quel dans une <iframe>, jamais fetché
 * @property {string} url - route prête à l'emploi (GET) : contenu JSON pour 'md', fichier PDF pour 'pdf'
 * @property {string} [content] - rempli une fois chargé (type 'md' uniquement)
 * @property {string} [error] - message d'erreur brut si le chargement a échoué
 * @property {boolean} loading
 * @property {boolean} loaded
 * @property {boolean} [expanded] - replié/déplié ; porté par le document (pas par ArchivisteDocument) pour survivre à une bascule de page
 */

/**
 * @typedef {Object} ArchivisteExchange
 * @property {string} id
 * @property {string} question
 * @property {ArchivisteDocument[]} documents
 * @property {boolean} loading
 * @property {string} [error]
 * @property {string | null} [messageId] - id du message assistant renvoyé par /archiviste ; handle pour /feedback
 * @property {-1 | 0 | 1} [rating] - note courante de la liste de résultats (0 = pas de note)
 */

/**
 * @typedef {Object} ArchivisteSearchResponse
 * @property {number} count - total des deux types confondus (Notion + sujets PDF)
 * @property {{name: string, score: number, type: 'md' | 'pdf', url: string}[]} documents
 * @property {string} [conversationId] - conversation à laquelle la recherche a été rattachée (T4) ; le hook le renvoie à la question suivante
 * @property {string} [messageId] - id du message assistant ; handle pour /feedback (absent si l'écriture de log a échoué)
 */

/**
 * Réponse de `POST /feedback`.
 *
 * @typedef {Object} FeedbackResponse
 * @property {boolean} ok
 * @property {-1 | 0 | 1} rating - la note désormais enregistrée (0 = retirée)
 */

/**
 * Une ligne de `GET /conversations` — l'historique de ce navigateur (tiroir).
 *
 * @typedef {Object} ConversationSummary
 * @property {string} id
 * @property {'chat' | 'archiviste'} page - page d'origine ; le tiroir y navigue avant de rouvrir
 * @property {string} title - première question, tronquée
 * @property {string} updatedAt - ISO
 * @property {number} messageCount
 */

/**
 * Un message de `GET /conversations/:id`.
 *
 * @typedef {Object} ConversationMessage
 * @property {string} id
 * @property {'user' | 'assistant'} role
 * @property {string} content
 * @property {string | null} language
 * @property {string} createdAt - ISO
 * @property {string | null} errorCode
 * @property {number | null} documentCount
 * @property {-1 | 1 | null} rating
 * @property {{ name: string, type: 'md' | 'pdf' | null, url: string | null, score: number | null }[]} documents - par `position` ; **références seules**, le contenu est refetché au dépli
 */

/**
 * Corps de `GET /conversations/:id` — une conversation prête à réafficher.
 *
 * @typedef {Object} ConversationDetail
 * @property {string} id
 * @property {'chat' | 'archiviste'} page
 * @property {string} title
 * @property {ConversationMessage[]} messages - chronologiques, la question avant sa réponse
 */

export {}
