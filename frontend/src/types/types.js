/**
 * @typedef {Object} Exchange
 * @property {string} id
 * @property {string} question
 * @property {string} answer
 * @property {boolean} loading
 * @property {string} [error] - message d'erreur brut ; le préfixe traduit est ajouté à l'affichage
 * @property {string | null} [messageId] - id du message assistant renvoyé par /chat ; handle pour /feedback (null tant que la réponse n'est pas revenue)
 * @property {-1 | 0 | 1} [rating] - note courante de la réponse (0 = pas de note) ; optimiste, rollback silencieux si l'envoi échoue
 */

/**
 * @typedef {Object} Source
 * @property {string} name
 * @property {string} path
 * @property {number} score
 */

/**
 * @typedef {Object} ChatResponse
 * @property {string} answer
 * @property {Source[]} sources
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

export {}
