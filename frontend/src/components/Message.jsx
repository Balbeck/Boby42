/**
 * @param {{ question: string, answer: string }} props
 */
export default function Message({ question, answer }) {
  return (
    <div className="flex flex-col gap-5 py-8">
      <div className="max-w-[85%] self-end rounded-2xl bg-chat-surface-2 px-4 py-3 text-chat-text">
        {question}
      </div>
      <div className="max-w-[85%] whitespace-pre-line leading-relaxed text-chat-text">
        {answer}
      </div>
    </div>
  )
}
