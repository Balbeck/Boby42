import ChatInput from './components/ChatInput'
import Disclaimer from './components/Disclaimer'
import Message from './components/Message'
import { useChat } from './hooks/useChat'

function App() {
  const { exchanges, sendQuestion } = useChat()
  const hasStarted = exchanges.length > 0

  return (
    <div className="flex min-h-svh justify-center bg-chat-bg">
      <div className="flex w-full max-w-2xl flex-col px-4">
        {!hasStarted && (
          <div className="relative flex-1">
            <h1 className="absolute top-[25%] left-1/2 w-full -translate-x-1/2 -translate-y-1/2 text-center text-3xl font-medium text-chat-text">
              🎋 Bonjour 🌞
            </h1>
            <div className="absolute top-1/2 left-1/2 w-full -translate-x-1/2 -translate-y-1/2">
              <ChatInput onSend={sendQuestion} autoFocus />
              <Disclaimer />
            </div>
          </div>
        )}

        {hasStarted && (
          <div className="flex flex-col divide-y divide-chat-border/60 pt-10 pb-10">
            {exchanges.map((exchange) => (
              <Message
                key={exchange.id}
                question={exchange.question}
                answer={exchange.answer}
                loading={exchange.loading}
              />
            ))}
            <div className="pt-8">
              <ChatInput onSend={sendQuestion} autoFocus />
              <Disclaimer />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
