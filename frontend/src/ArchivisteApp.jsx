import Composer from './components/Composer'
import Disclaimer from './components/Disclaimer'
import ArchivisteMessage from './components/ArchivisteMessage'
import { useAutoScroll } from './hooks/useAutoScroll'
import { useArchiviste } from './state/conversationsContext'
import { useLanguage, useMessages } from './i18n'
import { withNotionLink } from './notionLink'

function ArchivisteApp() {
  const {
    exchanges,
    sendQuestion,
    stopGeneration,
    submitFeedback,
    toggleDocument,
    draft,
    setDraft,
    isSending,
    isQueueFull,
  } = useArchiviste()
  const { containerRef, bottomRef } = useAutoScroll()
  const language = useLanguage()
  const t = useMessages()
  const hasStarted = exchanges.length > 0

  return (
    <div className="flex min-h-svh justify-center bg-chat-bg">
      <div className="page-in flex w-full max-w-2xl flex-col px-4">
        {!hasStarted && (
          <div className="relative flex-1">
            <div className="absolute top-[25%] left-1/2 w-full -translate-x-1/2 -translate-y-1/2 text-center">
              <h1 className="text-3xl font-medium text-chat-text">{t.archivisteTitle}</h1>
              <Disclaimer>
                <span className="text-white/75">{t.archivisteTagline}</span>
              </Disclaimer>
            </div>
            <div className="absolute top-1/2 left-1/2 w-full -translate-x-1/2 -translate-y-1/2">
              <Composer
                value={draft}
                onChange={setDraft}
                onSend={(question) => sendQuestion(question, language)}
                onStop={stopGeneration}
                isSending={isSending}
                queueFull={isQueueFull}
                autoFocus
                placeholder={t.archivisteInputPlaceholder}
                t={t}
                disclaimer={withNotionLink(t.archivisteDisclaimer, t.notionLinkLabel)}
              />
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
                  queued={exchange.queued}
                  error={exchange.error}
                  messageId={exchange.messageId}
                  rating={exchange.rating}
                  onRate={(rating, comment) => submitFeedback(exchange.id, rating, comment)}
                  onToggleDocument={(doc) => toggleDocument(exchange.id, doc)}
                  t={t}
                />
              ))}
              <div className="pt-8">
                <Composer
                  value={draft}
                  onChange={setDraft}
                  onSend={(question) => sendQuestion(question, language)}
                  onStop={stopGeneration}
                  isSending={isSending}
                  queueFull={isQueueFull}
                  autoFocus
                  placeholder={t.archivisteInputPlaceholder}
                  t={t}
                  disclaimer={withNotionLink(t.archivisteDisclaimer, t.notionLinkLabel)}
                />
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
