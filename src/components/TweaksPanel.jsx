import { motion, AnimatePresence } from 'framer-motion'

export default function TweaksPanel({ open, tweaks, onChange }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="sh-tweaks"
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 12 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
          <div className="sh-tweaks-head mono">TWEAKS</div>

          <div className="sh-tweaks-row">
            <label className="mono">Theme</label>
            <div className="sh-seg">
              {['dark', 'light'].map(t => (
                <button key={t} className={tweaks.theme === t ? 'on' : ''} onClick={() => onChange({ theme: t })}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="sh-tweaks-row">
            <label className="mono">
              Accent Hue <span className="sh-tweaks-val">{tweaks.accentHue}°</span>
            </label>
            <input
              type="range" min="0" max="360"
              value={tweaks.accentHue}
              onChange={e => onChange({ accentHue: +e.target.value })}
            />
          </div>

          <div className="sh-tweaks-row">
            <label className="mono">
              Chroma <span className="sh-tweaks-val">{tweaks.accentChroma.toFixed(2)}</span>
            </label>
            <input
              type="range" min="0" max="0.3" step="0.01"
              value={tweaks.accentChroma}
              onChange={e => onChange({ accentChroma: +e.target.value })}
            />
          </div>

          <div className="sh-tweaks-row">
            <label className="mono">Density</label>
            <div className="sh-seg">
              {['compact', 'comfortable'].map(d => (
                <button key={d} className={tweaks.density === d ? 'on' : ''} onClick={() => onChange({ density: d })}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="sh-tweaks-row">
            <label className="mono">Grid overlay</label>
            <div className="sh-seg">
              <button className={tweaks.showGrid ? 'on' : ''} onClick={() => onChange({ showGrid: !tweaks.showGrid })}>
                {tweaks.showGrid ? 'on' : 'off'}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
