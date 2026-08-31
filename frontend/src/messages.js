/**
 * Toutes les chaînes d'interface, par langue.
 * Affichage : `messages[language].<clé>`. Une valeur est une chaîne, ou une
 * fonction (pluriels). `'origin'` n'a pas d'entrée — les pages retombent sur `fr`.
 */
/** Notion « RTFM - stud » du Bocal de 42 — cible du lien dans le disclaimer du chat. */
export const NOTION_RTFM_URL = 'https://ft42.notion.site/rtfm-stud'

export const messages = {
  fr: {
    chatGreeting: '🎋 Bonjour',
    chatInputPlaceholder: 'Comment puis je vous aider ?',
    chatDisclaimer:
      'Boby42 est un assistant administratif qui répond à partir du RTFM - Notion du Bocal.\nPour l\'instant, seuls les sujets du Old Common Core et de la branche Machine Learning sont indexés.\nIl est encore en formation et peut se tromper - Vérifiez ce qu\'il vous conte 🤖 !',
    chatDisclaimerNotion: 'RTFM - Notion du Bocal',
    intro: 'Laissez-moi voir ce que je peux faire',
    searching: "Je consulte la base documentaire de l'école",
    chatReading: 'Je lis les documents et je prépare ma réponse',
    chatDocsNotionLabel: 'RTFM - Notion',
    chatDocsSubjectsLabel: 'Sujets Projet 42',
    chatDocsCount: (n) => `${n} document${n > 1 ? 's' : ''} trouvé${n > 1 ? 's' : ''}`,
    archivisteTitle: '🕵️‍♂️ Archiviste 42',
    archivisteInputPlaceholder: 'Quels documents souhaitez-vous ?',
    archivisteDisclaimer:
      'Je fouille les docs administratifs du RTFM - Notion, tenus à jour par le Bocal de 42 Paris 📚\nPour l\'instant, seuls les sujets du Old Common Core et de la branche Machine Learning sont indexés.',
    archivisteDisclaimerNotion: 'RTFM - Notion',
    archivisteSearching: "Je consulte la base documentaire de l'école...",
    documentsFound: (n) => `${n} document${n > 1 ? 's' : ''} trouvé${n > 1 ? 's' : ''} dans le Notion`,
    subjectsPdfFound: (n) => `${n} sujet${n > 1 ? 's' : ''} 42 trouvé${n > 1 ? 's' : ''} dans la base`,
    openInNewTab: 'Ouvrir dans un nouvel onglet',
    feedbackUp: 'Réponse utile',
    feedbackDown: 'Réponse peu utile',
    feedbackCommentPlaceholder: "Qu'est-ce qui n'allait pas ? (facultatif)",
    feedbackCommentSend: 'Envoyer le commentaire',
    errorPrefix: 'Erreur : ',
    loading: 'Chargement...',
    stopAria: 'Arrêter la génération',
    sendAria: 'Envoyer le message',
    switchToChat: 'Basculer vers le chat',
    switchToArchiviste: "Basculer vers l'archiviste",
    close: 'Fermer',
    wipTitle: '🏗️ Section en construction 🛠️',
    wipBody:
      "Cette partie de Boby42 est encore en développement — ce qui peut expliquer des réponses parfois décevantes. Laissez-lui quand même sa chance, il apprend vite 👨🏻‍🏭",
  },
  en: {
    chatGreeting: '🎋 Bonjour',
    chatInputPlaceholder: 'How can I help you?',
    chatDisclaimer:
      "Boby42 is an administrative assistant answering from the Bocal's RTFM - Notion.\nFor now, only the Old Common Core and Machine Learning branch subjects are indexed.\nHe is still in training and can be wrong — double-check what he tells you 🤖 !",
    chatDisclaimerNotion: "Bocal's RTFM - Notion",
    intro: 'Let me see what I can do',
    searching: "Searching the school's document base",
    chatReading: 'Reading the documents and writing my answer',
    chatDocsNotionLabel: 'RTFM - Notion',
    chatDocsSubjectsLabel: '42 Project Subjects',
    chatDocsCount: (n) => `${n} document${n === 1 ? '' : 's'} found`,
    archivisteTitle: '🕵️‍♂️ 42 Archivist',
    archivisteInputPlaceholder: 'Which documents are you looking for?',
    archivisteDisclaimer:
      "I search the administrative RTFM - Notion docs, kept up to date by 42 Paris's Bocal 📚\nFor now, only the Old Common Core and Machine Learning branch subjects are indexed.",
    archivisteDisclaimerNotion: 'RTFM - Notion',
    archivisteSearching: "Searching the school's document base...",
    documentsFound: (n) => `${n} document${n > 1 ? 's' : ''} found in Notion`,
    subjectsPdfFound: (n) => `${n} subject${n > 1 ? 's' : ''} from 42 found in the base`,
    openInNewTab: 'Open in a new tab',
    feedbackUp: 'Helpful answer',
    feedbackDown: 'Unhelpful answer',
    feedbackCommentPlaceholder: 'What was wrong? (optional)',
    feedbackCommentSend: 'Send comment',
    errorPrefix: 'Error: ',
    loading: 'Loading...',
    stopAria: 'Stop generation',
    sendAria: 'Send message',
    switchToChat: 'Switch to chat',
    switchToArchiviste: 'Switch to archiviste',
    close: 'Close',
    wipTitle: '🏗️ Section under construction 🛠️',
    wipBody:
      "This part of Boby42 is still under development — which can explain some disappointing answers. Give him a chance anyway, he learns fast 👨🏻‍🏭",
  },
}
