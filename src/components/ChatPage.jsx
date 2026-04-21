import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from './ui/Icon'
import ChatBubble, { TypingBubble } from './chat/ChatBubble'
import ToolPill from './chat/ToolPill'
import { createRecognizer, isSpeechSupported } from '../utils/speech'

const detectVoiceLang = () => {
  const nav = typeof navigator !== 'undefined' ? (navigator.language || '') : ''
  return nav.toLowerCase().startsWith('en') ? 'en-US' : 'th-TH'
}

export default function ChatPage({
  messages, onSend, thinking, executing, onClear, modelName, skillCount, msgCount,
}) {
  const [draft, setDraft] = useState('')
  const [listening, setListening] = useState(false)
  const [voiceError, setVoiceError] = useState(null)
  const scrollRef = useRef(null)
  const recogRef = useRef(null)
  const draftBeforeVoice = useRef('')

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, thinking, executing])

  useEffect(() => () => recogRef.current?.abort(), [])

  const submit = () => {
    if (draft.trim()) { onSend(draft.trim()); setDraft('') }
  }

  const toggleVoice = () => {
    if (listening) { recogRef.current?.stop(); return }
    if (!isSpeechSupported()) {
      setVoiceError('เบราว์เซอร์นี้ไม่รองรับ Voice (ลองใช้ Chrome/Edge)')
      setTimeout(() => setVoiceError(null), 3000)
      return
    }
    draftBeforeVoice.current = draft ? draft + ' ' : ''
    const rec = createRecognizer({
      lang: detectVoiceLang(),
      onResult: (text) => setDraft(draftBeforeVoice.current + text),
      onEnd:    (finalText) => {
        setListening(false)
        if (finalText) {
          const full = (draftBeforeVoice.current + finalText).trim()
          setDraft('')
          onSend(full)
        }
      },
      onError: (err) => {
        setListening(false)
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          setVoiceError('กรุณาอนุญาตไมโครโฟนในเบราว์เซอร์')
        } else if (err !== 'aborted' && err !== 'no-speech') {
          setVoiceError(`Voice error: ${err}`)
        }
        setTimeout(() => setVoiceError(null), 3000)
      },
    })
    if (!rec) return
    recogRef.current = rec
    rec.start()
    setListening(true)
  }

  const busy = thinking || !!executing

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
              <span className="mono">พิมพ์คำสั่ง หรือกดไมค์เพื่อพูด</span>
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
          <AnimatePresence>
            {voiceError && (
              <motion.div
                className="sh-voice-error mono"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <Icon name="alert" size={11} /> {voiceError}
              </motion.div>
            )}
          </AnimatePresence>

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
              placeholder={listening ? '🎙️ กำลังฟัง…' : "สั่งงานบ้าน… เช่น 'เปิดไฟห้องนั่งเล่น' หรือ 'dim bedroom to 80'"}
              rows={1}
              disabled={listening}
            />
            <motion.button
              type="button"
              className={`sh-mic ${listening ? 'on' : ''}`}
              onClick={toggleVoice}
              disabled={busy}
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
              title={listening ? 'หยุดฟัง' : 'พูดใส่ไมค์'}
            >
              <Icon name={listening ? 'micOff' : 'mic'} size={15} />
            </motion.button>
            <motion.button
              type="submit"
              className="sh-send"
              disabled={!draft.trim() || busy || listening}
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
