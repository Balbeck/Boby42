/**
 * Toutes les chaînes d'interface, par langue.
 * Affichage : `messages[language].<clé>`. Une valeur est une chaîne, ou une
 * fonction (pluriels). `'origin'` n'a pas d'entrée — les pages retombent sur `fr`.
 */
export const messages = {
  fr: {
    chatGreeting: '🎋 Bonjour',
    chatInputPlaceholder: 'Comment puis je vous aider ?',
    chatDisclaimer:
      'Boby42 est un assistant administratif qui répond à partir du RTFM et du Notion du Bocal.\nIl est encore en formation et peut se tromper - Vérifiez ce qu\'il vous conte 🤖 !',
    intro: 'Laissez-moi voir ce que je peux faire',
    searching: "Je consulte la base documentaire de l'école",
    archivisteTitle: '🕵️‍♂️ Le Documentaliste',
    archivisteInputPlaceholder: 'Quels documents souhaitez-vous ?',
    archivisteDisclaimer:
      "Je fouille dans le Notion tenu à jour par le Bocal de 42 Paris pour retrouver les bons documents. Ils peuvent être en français, en anglais, ou dans leur langue d'origine, telle qu'écrite par le Bocal 📚",
    archivisteSearching: "Je consulte la base documentaire de l'école...",
    documentsFound: (n) => `${n} document${n > 1 ? 's' : ''} trouvé${n > 1 ? 's' : ''} dans le Notion`,
    subjectsPdfFound: (n) => `${n} sujet${n > 1 ? 's' : ''} 42 trouvé${n > 1 ? 's' : ''} dans la base`,
    openInNewTab: 'Ouvrir dans un nouvel onglet',
    errorPrefix: 'Erreur : ',
    loading: 'Chargement...',
    stopAria: 'Arrêter la génération',
    sendAria: 'Envoyer le message',
    switchToChat: 'Basculer vers le chat',
    switchToArchiviste: 'Basculer vers le documentaliste',
    close: 'Fermer',
    wipTitle: '🏗️ Section en construction 🛠️',
    wipBody:
      "Cette partie de Boby42 est encore en développement — ce qui peut expliquer des réponses parfois décevantes. Laissez-lui quand même sa chance, il apprend vite 👨🏻‍🏭",
  },
  en: {
    chatGreeting: '🎋 Bonjour',
    chatInputPlaceholder: 'How can I help you?',
    chatDisclaimer:
      "Boby42 is an administrative assistant answering from the RTFM and the Bocal's Notion.\nHe is still in training and can be wrong — double-check what he tells you 🤖 !",
    intro: 'Let me see what I can do',
    searching: "Searching the school's document base",
    archivisteTitle: '🕵️‍♂️ The Archivist',
    archivisteInputPlaceholder: 'Which documents are you looking for?',
    archivisteDisclaimer:
      "I dig through the Notion kept up to date by 42 Paris's Bocal to find the right documents. They may be in French, in English, or in their original language, as written by the Bocal 📚",
    archivisteSearching: "Searching the school's document base...",
    documentsFound: (n) => `${n} document${n > 1 ? 's' : ''} found in Notion`,
    subjectsPdfFound: (n) => `${n} subject${n > 1 ? 's' : ''} from 42 found in the base`,
    openInNewTab: 'Open in a new tab',
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
