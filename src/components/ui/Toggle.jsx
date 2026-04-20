import { motion } from 'framer-motion'

export default function Toggle({ on, onChange }) {
  return (
    <button
      className={`sh-toggle ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
    >
      <span className="sh-toggle-track">
        <span className="sh-toggle-glow" />
      </span>
      <motion.span
        className="sh-toggle-thumb"
        animate={{ x: on ? 18 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        style={{ position: 'absolute', left: 2, top: 2 }}
      />
    </button>
  )
}
