import ChatInput from './ChatInput'
import Disclaimer from './Disclaimer'

/**
 * The page's composer: the shared `<ChatInput>` followed by the `<Disclaimer>`.
 * `App.jsx` and `ArchivisteApp.jsx` each render this exact pair twice — once on
 * the empty page, once on the started page — with the same props; this is that
 * pair in one place. It is a plain fragment, so the rendered DOM is unchanged.
 *
 * Every prop except `disclaimer` is forwarded verbatim to `<ChatInput>`; keep
 * this list matching `ChatInput.jsx`'s signature. `disclaimer` is the
 * already-translated footer node, handed to `<Disclaimer>` as its children.
 *
 * This is intra-page deduplication only — it does not wrap a page's layout. A
 * shared page shell was considered and rejected (see `frontend/CLAUDE.md`).
 *
 * @param {{
 *   value: string,
 *   onChange: (value: string) => void,
 *   onSend: (value: string) => void,
 *   onStop?: () => void,
 *   isSending?: boolean,
 *   queueFull?: boolean,
 *   autoFocus?: boolean,
 *   placeholder?: string,
 *   t: import('../types/types.js').Messages,
 *   disclaimer: import('react').ReactNode,
 * }} props
 */
export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  isSending,
  queueFull,
  autoFocus,
  placeholder,
  t,
  disclaimer,
}) {
  return (
    <>
      <ChatInput
        value={value}
        onChange={onChange}
        onSend={onSend}
        onStop={onStop}
        isSending={isSending}
        queueFull={queueFull}
        autoFocus={autoFocus}
        placeholder={placeholder}
        t={t}
      />
      <Disclaimer>{disclaimer}</Disclaimer>
    </>
  )
}
