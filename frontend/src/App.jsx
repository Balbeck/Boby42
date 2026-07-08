import ChatInput from './components/ChatInput'
import Message from './components/Message'
import { useChat } from './hooks/useChat'

function App() {
  const { exchanges, sendQuestion } = useChat()
  const hasStarted = exchanges.length > 0

  return (
    <div className="flex min-h-svh justify-center bg-chat-bg">
      <div className="flex w-full max-w-2xl flex-col px-4">
        {!hasStarted && (
          <div className="flex flex-1 flex-col items-center justify-center gap-8 pb-32">
            <h1 className="text-3xl font-medium text-chat-text">
              🎋 Bonjour 🌞
            </h1>
            <h1 className="text-2xl font-medium text-chat-text">
              🤖 Je suis Boby votre assistant 42
            </h1>
            <ChatInput onSend={sendQuestion} autoFocus />
          </div>
        )}

        {hasStarted && (
          <div className="flex flex-col divide-y divide-chat-border/60 pt-10 pb-10">
            {exchanges.map((exchange) => (
              <Message
                key={exchange.id}
                question={exchange.question}
                answer={exchange.answer}
              />
            ))}
            <div className="pt-8">
              <ChatInput onSend={sendQuestion} autoFocus />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
