import { useState } from 'react'
import ChatInput from './components/ChatInput'
import Disclaimer from './components/Disclaimer'
import ArchivisteMessage from './components/ArchivisteMessage'
import LanguageSwitcher from './components/LanguageSwitcher'
import { useAutoScroll } from './hooks/useAutoScroll'
import { useArchiviste } from './hooks/useArchiviste'

function ArchivisteApp() {
  const { exchanges, sendQuestion, stopGeneration, isSending, loadDocument } = useArchiviste()
  const { containerRef, bottomRef } = useAutoScroll()
  const [language, setLanguage] = useState('fr')
  const hasStarted = exchanges.length > 0

  return (
    <div className="flex min-h-svh justify-center bg-chat-bg">
      <div className="fixed top-4 right-4 z-20">
        <LanguageSwitcher language={language} onChange={setLanguage} />
      </div>
      <div className="flex w-full max-w-2xl flex-col px-4">
        {!hasStarted && (
          <div className="relative flex-1">
            <h1 className="absolute top-[25%] left-1/2 w-full -translate-x-1/2 -translate-y-1/2 text-center text-3xl font-medium text-chat-text">
              🗄️ Archiviste
            </h1>
            <div className="absolute top-1/2 left-1/2 w-full -translate-x-1/2 -translate-y-1/2">
              <ChatInput
                onSend={(question) => sendQuestion(question, language)}
                onStop={stopGeneration}
                isSending={isSending}
                autoFocus
              />
              <Disclaimer />
            </div>
          </div>
        )}

        {hasStarted && (
          <div ref={containerRef} className="flex flex-col pt-10 pb-10">
            <div className="flex flex-col divide-y divide-chat-border/60">
              {exchanges.map((exchange) => (
                <ArchivisteMessage
                  key={exchange.id}
                  question={exchange.question}
                  documents={exchange.documents}
                  loading={exchange.loading}
                  error={exchange.error}
                  onLoadDocument={(doc) => loadDocument(exchange.id, doc, language)}
                />
              ))}
              <div className="pt-8">
                <ChatInput
                  onSend={(question) => sendQuestion(question, language)}
                  onStop={stopGeneration}
                  isSending={isSending}
                  autoFocus
                />
                <Disclaimer />
              </div>
            </div>
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  )
}

export default ArchivisteApp
