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
    chatTagline: 'Une question sur l\'administratif et les projets de 42.',
    chatTaglineSub:
      'Une bourse, un blackhole, c\'est quoi minishell ? Demande, je source mes réponses.',
    chatInputPlaceholder: 'Comment puis je vous aider ?',
    chatDisclaimer:
      'Deux sources indexées : RTFM - Notion (complet)\net sujets de projets 42 (Ancien Tronc Commun + branche Machine Learning). Le reste arrive.',
    chatDisclaimerNotion: 'RTFM - Notion',
    intro: 'Laissez-moi voir ce que je peux faire',
    searching: "Je consulte la base documentaire de l'école",
    chatReading: 'Je lis les documents et je prépare ma réponse',
    chatNotFound: `🤔 Je n'ai malheureusement aucune information à ce sujet dans mes données.\nJe vous conseille la ${NOTION_RTFM_URL} .\nVous y trouverez peut-être votre réponse !`,
    chatDocsNotionLabel: 'RTFM - Notion',
    chatDocsSubjectsLabel: 'Sujets Projet 42',
    chatDocsCount: (n) => `${n} document${n > 1 ? 's' : ''} trouvé${n > 1 ? 's' : ''}`,
    archivisteTitle: '🕵️‍♂️ Archiviste 42',
    archivisteTagline:
      'Décris ce que tu cherches, je te renvoie les documents classés par pertinence.',
    archivisteInputPlaceholder: 'Quels documents souhaitez-vous ?',
    archivisteDisclaimer:
      'Deux sources indexées : RTFM - Notion (complet)\net sujets de projets 42 (Ancien Tronc Commun + branche Machine Learning). Le reste arrive.',
    archivisteDisclaimerNotion: 'RTFM - Notion',
    archivisteSearching: "Je consulte la base documentaire de l'école...",
    documentsFound: (n) => `${n} document${n > 1 ? 's' : ''} trouvé${n > 1 ? 's' : ''} dans le Notion`,
    subjectsPdfFound: (n) => `${n} sujet${n > 1 ? 's' : ''} 42 trouvé${n > 1 ? 's' : ''} dans la base`,
    archivisteEmpty:
      'Rien trouvé. Essaie d\'autres mots, ou vérifie que ton sujet est dans le périmètre indexé.',
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
    pageSwitchArchiviste: 'Archiviste',
    pageSwitchChat: 'Boby42',
    close: 'Fermer',
    menuOpen: 'Ouvrir les conversations',
    menuClose: 'Fermer les conversations',
    conversations: 'Conversations',
    newConversation: 'Nouvelle conversation',
    conversationsEmpty: 'Vos conversations apparaîtront ici.',
    justNow: "à l'instant",
    wipTitle: '🚧 Boby42 vous souhaite la bienvenue 🏗️',
    wipBody:
      "🤖 💬 « Je suis actuellement en phase de test, encore en apprentissage.\nMa base documentaire est en cours d'élargissement.\nN'hésitez pas à me donner votre avis ! »",
  },
  en: {
    chatGreeting: '🎋 Bonjour',
    chatTagline: "Any question about 42's admin and projects.",
    chatTaglineSub: 'Grant, blackhole, what is minishell? Just ask — I source my answers.',
    chatInputPlaceholder: 'How can I help you?',
    chatDisclaimer:
      'Two indexed sources: RTFM - Notion (complete)\nand 42 project subjects (Old Common Core + Machine Learning branch). The rest is coming.',
    chatDisclaimerNotion: 'RTFM - Notion',
    intro: 'Let me see what I can do',
    searching: "Searching the school's document base",
    chatReading: 'Reading the documents and writing my answer',
    chatNotFound: `🤔 Sorry, I don't have any information about this in my data.\nI'd suggest checking ${NOTION_RTFM_URL} .\nYou might find your answer there!`,
    chatDocsNotionLabel: 'RTFM - Notion',
    chatDocsSubjectsLabel: '42 Project Subjects',
    chatDocsCount: (n) => `${n} document${n === 1 ? '' : 's'} found`,
    archivisteTitle: '🕵️‍♂️ 42 Archivist',
    archivisteTagline: 'Describe what you need, I return the matching documents ranked by relevance.',
    archivisteInputPlaceholder: 'Which documents are you looking for?',
    archivisteDisclaimer:
      'Two indexed sources: RTFM - Notion (complete)\nand 42 project subjects (Old Common Core + Machine Learning branch). The rest is coming.',
    archivisteDisclaimerNotion: 'RTFM - Notion',
    archivisteSearching: "Searching the school's document base...",
    documentsFound: (n) => `${n} document${n > 1 ? 's' : ''} found in Notion`,
    subjectsPdfFound: (n) => `${n} subject${n > 1 ? 's' : ''} from 42 found in the base`,
    archivisteEmpty:
      'Nothing found. Try other words, or check that your topic is within the indexed scope.',
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
    pageSwitchArchiviste: 'Archivist',
    pageSwitchChat: 'Boby42',
    close: 'Close',
    menuOpen: 'Open conversations',
    menuClose: 'Close conversations',
    conversations: 'Conversations',
    newConversation: 'New conversation',
    conversationsEmpty: 'Your conversations will show up here.',
    justNow: 'just now',
    wipTitle: '🚧 Boby42 welcomes you 🏗️',
    wipBody:
      '🤖 💬 "I\'m currently in a testing phase, still learning.\nMy document base is being expanded.\nFeel free to share your feedback!"',
  },
}
