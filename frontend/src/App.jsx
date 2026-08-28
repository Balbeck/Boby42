import ChatInput from './components/ChatInput'
import Disclaimer from './components/Disclaimer'
import Message from './components/Message'
import PageSwitcher from './components/PageSwitcher'
import LanguageSwitcher from './components/LanguageSwitcher'
import { useAutoScroll } from './hooks/useAutoScroll'
import { useChat } from './hooks/useChat'
import { messages, useLanguage, setLanguage } from './i18n'

function App() {
  const { exchanges, sendQuestion, stopGeneration, isSending } = useChat()
  const { containerRef, bottomRef } = useAutoScroll()
  const language = useLanguage()
  const t = messages[language] ?? messages.fr
  const hasStarted = exchanges.length > 0

  return (
    <div className="flex min-h-svh justify-center bg-chat-bg">
      <div className="fixed top-4 left-4 z-20">
        <PageSwitcher t={t} />
      </div>
      <div className="fixed top-4 right-4 z-20">
        <LanguageSwitcher language={language} onChange={setLanguage} />
      </div>
      <div className="flex w-full max-w-2xl flex-col px-4">
        {!hasStarted && (
          <div className="relative flex-1">
            <h1 className="absolute top-[25%] left-1/2 w-full -translate-x-1/2 -translate-y-1/2 text-center text-3xl font-medium text-chat-text">
              {t.chatGreeting}
            </h1>
            <div className="absolute top-1/2 left-1/2 w-full -translate-x-1/2 -translate-y-1/2">
              <ChatInput
                onSend={sendQuestion}
                onStop={stopGeneration}
                isSending={isSending}
                autoFocus
                t={t}
              />
              <Disclaimer>{t.chatDisclaimer}</Disclaimer>
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
                  loading={exchange.loading}
                  error={exchange.error}
                  t={t}
                />
              ))}
              <div className="pt-8">
                <ChatInput
                  onSend={sendQuestion}
                  onStop={stopGeneration}
                  isSending={isSending}
                  autoFocus
                  t={t}
                />
                <Disclaimer>{t.chatDisclaimer}</Disclaimer>
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
