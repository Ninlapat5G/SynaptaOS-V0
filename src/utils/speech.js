// ── Web Speech API wrapper ────────────────────────────────────────────────────
// Chrome/Edge uses Google's speech engine — accurate for Thai and English.
// Returns null if the browser has no SpeechRecognition support (Firefox/Safari desktop).

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null

export const isSpeechSupported = () => !!SR

export function createRecognizer({ lang = 'th-TH', onResult, onEnd, onError }) {
  if (!SR) return null
  const rec = new SR()
  rec.lang           = lang
  rec.continuous     = false
  rec.interimResults = true
  rec.maxAlternatives = 1

  let finalText = ''

  rec.onresult = e => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finalText += r[0].transcript
      else           interim  += r[0].transcript
    }
    onResult?.(finalText + interim, !!e.results[e.results.length - 1]?.isFinal)
  }

  rec.onerror = e => onError?.(e.error || 'speech-error')
  rec.onend   = ()   => onEnd?.(finalText.trim())

  return {
    start: () => { finalText = ''; try { rec.start() } catch {} },
    stop:  () => { try { rec.stop() } catch {} },
    abort: () => { try { rec.abort() } catch {} },
  }
}
