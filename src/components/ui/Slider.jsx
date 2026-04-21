import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'

export default function Slider({ value, onChange, max = 255 }) {
  const trackRef  = useRef(null)
  const [dragging, setDragging] = useState(false)

  const valueAt = useCallback(e => {
    const el = trackRef.current
    if (!el) return 0
    const rect    = el.getBoundingClientRect()
    const clientX = e.touches?.[0]?.clientX ?? e.changedTouches?.[0]?.clientX ?? e.clientX
    return Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * max)
  }, [max])

  useEffect(() => {
    if (!dragging) return
    const move = e => { e.preventDefault(); onChange(valueAt(e), false) }
    const up   = e => { setDragging(false); onChange(valueAt(e), true) }
    window.addEventListener('mousemove',  move)
    window.addEventListener('mouseup',    up)
    window.addEventListener('touchmove',  move, { passive: false })
    window.addEventListener('touchend',   up)
    return () => {
      window.removeEventListener('mousemove',  move)
      window.removeEventListener('mouseup',    up)
      window.removeEventListener('touchmove',  move)
      window.removeEventListener('touchend',   up)
    }
  }, [dragging, onChange, valueAt])

  const pct = (value / max) * 100

  return (
    <div className={`sh-slider ${dragging ? 'dragging' : ''}`}>
      <div
        className="sh-slider-track"
        ref={trackRef}
        onMouseDown={e => { setDragging(true); onChange(valueAt(e), false) }}
        onTouchStart={e => { setDragging(true); onChange(valueAt(e), false) }}
      >
        <div className="sh-slider-ticks">
          {Array.from({ length: 32 }).map((_, i) => (
            <span key={i} style={{ opacity: (i / 32) * 100 < pct ? 1 : 0.18 }} />
          ))}
        </div>
        <div className="sh-slider-fill" style={{ width: `${pct}%` }} />
        <motion.div
          className="sh-slider-thumb"
          style={{ left: `${pct}%` }}
          animate={{ scale: dragging ? 1.25 : 1 }}
          transition={{ type: 'spring', stiffness: 600, damping: 30 }}
        />
        {dragging && (
          <motion.div
            className="sh-slider-bubble mono"
            style={{ left: `${pct}%` }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {value}
          </motion.div>
        )}
      </div>
    </div>
  )
}
