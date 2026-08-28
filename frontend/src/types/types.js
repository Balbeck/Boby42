/**
 * @typedef {Object} Exchange
 * @property {string} id
 * @property {string} question
 * @property {string} answer
 * @property {boolean} loading
 * @property {string} [error] - message d'erreur brut ; le préfixe traduit est ajouté à l'affichage
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
 */

/**
 * @typedef {Object} ArchivisteDocument
 * @property {string} name
 * @property {number} score
 * @property {string} url - route prête à l'emploi pour récupérer le contenu (GET)
 * @property {string} [content] - rempli une fois chargé
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
 */

/**
 * @typedef {Object} ArchivisteSearchResponse
 * @property {number} count
 * @property {{name: string, score: number, url: string}[]} documents
 */

export {}
