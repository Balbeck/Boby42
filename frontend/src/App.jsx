import { useState } from 'react'
import ChatInput from './components/ChatInput'
import Disclaimer from './components/Disclaimer'
import Message from './components/Message'
import ConstructionNotice from './components/ConstructionNotice'
import { useAutoScroll } from './hooks/useAutoScroll'
import { useChat } from './state/conversationsContext'
import { messages, useLanguage } from './i18n'
import { withNotionLink } from './notionLink'

// Vu une seule fois par chargement de page : le flag survit aux remontages de
// <App> (bascule /chat ↔ /archiviste) mais est remis à zéro par un vrai reload.
let wipSeen = false

function App() {
  const {
    exchanges,
    sendQuestion,
    stopGeneration,
    submitFeedback,
    toggleDocument,
    draft,
    setDraft,
    isSending,
  } = useChat()
  const { containerRef, bottomRef } = useAutoScroll()
  const language = useLanguage()
  const t = messages[language] ?? messages.fr
  const hasStarted = exchanges.length > 0
  const [showWip, setShowWip] = useState(!wipSeen)
  const dismissWip = () => {
    wipSeen = true
    setShowWip(false)
  }

  return (
    <div className="flex min-h-svh justify-center bg-chat-bg">
      {showWip && <ConstructionNotice onClose={dismissWip} />}
      <div className="page-in flex w-full max-w-2xl flex-col px-4">
        {!hasStarted && (
          <div className="relative flex-1">
            <h1 className="absolute top-[25%] left-1/2 w-full -translate-x-1/2 -translate-y-1/2 text-center text-3xl font-medium text-chat-text">
              {t.chatGreeting}
            </h1>
            <div className="absolute top-1/2 left-1/2 w-full -translate-x-1/2 -translate-y-1/2">
              <ChatInput
                value={draft}
                onChange={setDraft}
                onSend={(question) => sendQuestion(question, language)}
                onStop={stopGeneration}
                isSending={isSending}
                autoFocus
                t={t}
              />
              <Disclaimer>{withNotionLink(t.chatDisclaimer, t.chatDisclaimerNotion)}</Disclaimer>
            </div>
          </div>
        )}

        {hasStarted && (
          <div ref={containerRef} className="flex flex-col pt-10 pb-10">
            <div className="flex flex-col divide-y divide-chat-border/60">
              {exchanges.map((exchange) => (
                <Message
                  key={exchange.id}
                  question={exchange.question}
                  answer={exchange.answer}
                  documents={exchange.documents}
                  phase={exchange.phase}
                  error={exchange.error}
                  messageId={exchange.messageId}
                  rating={exchange.rating}
                  onRate={(rating, comment) => submitFeedback(exchange.id, rating, comment)}
                  onToggleDocument={(doc) => toggleDocument(exchange.id, doc)}
                  t={t}
                />
              ))}
              <div className="pt-8">
                <ChatInput
                  value={draft}
                  onChange={setDraft}
                  onSend={(question) => sendQuestion(question, language)}
                  onStop={stopGeneration}
                  isSending={isSending}
                  autoFocus
                  t={t}
                />
                <Disclaimer>{withNotionLink(t.chatDisclaimer, t.chatDisclaimerNotion)}</Disclaimer>
              </div>
            </div>
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  )
}

export default App
