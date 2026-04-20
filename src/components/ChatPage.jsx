import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from './ui/Icon'
import ChatBubble, { TypingBubble } from './chat/ChatBubble'
import ToolPill from './chat/ToolPill'

export default function ChatPage({
  messages, onSend, thinking, executing, onClear, modelName, skillCount, msgCount,
}) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, thinking, executing])

  const submit = () => {
    if (draft.trim()) { onSend(draft.trim()); setDraft('') }
  }

  return (
    <div className="sh-chatpage">
      <div className="sh-chat-frame">
        {/* Header */}
        <div className="sh-side-head">
          <div className="sh-side-title">
            <div className="sh-side-dot" />
            <div>
              <div className="sh-side-h1">Assistant</div>
              <div className="sh-side-h2 mono">{modelName || 'typhoon-v2'} · {msgCount} msgs</div>
            </div>
          </div>
          <div className="sh-side-head-right">
            <div className="sh-side-chips mono">
              <span className="sh-chip">{skillCount} tools</span>
              <span className="sh-chip sh-nav-live"><i />live</span>
            </div>
            <button className="sh-icon-btn sh-clear-btn" onClick={onClear} title="Clear chat">
              <Icon name="trash" size={15} />
            </button>
          </div>
        </div>

        {/* Message list */}
        <div className="sh-side-scroll" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="sh-chat-empty">
              <Icon name="sparkle" size={28} />
              <p>เริ่มต้นบทสนทนาใหม่</p>
              <span className="mono">พิมพ์คำสั่งหรือคำถามด้านล่าง</span>
            </div>
          ) : (
            <>
              <div className="sh-side-timestamp mono">— บทสนทนา —</div>
              {messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
            </>
          )}

          <AnimatePresence>
            {executing && (
              <ToolPill
                key="executing"
                name={executing.name}
                args={executing.args}
                executing
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {thinking && !executing && <TypingBubble key="typing" />}
          </AnimatePresence>
        </div>

        {/* Composer */}
        <form
          className="sh-composer"
          onSubmit={e => { e.preventDefault(); submit() }}
        >
          <div className="sh-composer-row">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder="สั่งงานบ้าน… เช่น 'เปิดไฟห้องนั่งเล่น' หรือ 'dim bedroom to 80'"
              rows={1}
            />
            <motion.button
              type="submit"
              className="sh-send"
              disabled={!draft.trim() || thinking || !!executing}
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
            >
              <Icon name="send" size={15} />
            </motion.button>
          </div>
          <div className="sh-composer-hints mono">
            <span>⏎ ส่ง</span>
            <span>⇧⏎ บรรทัดใหม่</span>
            <span className="sh-composer-spacer" />
            <span><Icon name="shield" size={10} /> encrypted</span>
          </div>
        </form>
      </div>
    </div>
  )
}
