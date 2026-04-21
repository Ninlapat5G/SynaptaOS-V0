import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import Icon from './ui/Icon'
import { buildPayload, encodePayload } from '../utils/qrshare'

const DEFAULT_SCOPES = {
  profile:   false,
  llmConfig: false,
  apiKey:    false,
  mqtt:      false,
  skills:    false,
  theme:     false,
  devices:   [], // array of device ids
}

export default function QRShareModal({ open, onClose, mode: initialMode = 'share',
  settings, devices, tweaks, onScanned }) {
  const [mode, setMode] = useState(initialMode)

  useEffect(() => { if (open) setMode(initialMode) }, [open, initialMode])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="sh-modal-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="sh-modal"
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="sh-modal-head">
              <div className="sh-seg">
                <button className={mode === 'share' ? 'on' : ''} onClick={() => setMode('share')}>
                  <Icon name="qr" size={13} /> สร้าง QR
                </button>
                <button className={mode === 'scan' ? 'on' : ''} onClick={() => setMode('scan')}>
                  <Icon name="scan" size={13} /> สแกน QR
                </button>
              </div>
              <button className="sh-icon-btn" onClick={onClose} title="Close">
                <Icon name="close" size={15} />
              </button>
            </div>

            <div className="sh-modal-body">
              {mode === 'share'
                ? <ShareTab settings={settings} devices={devices} tweaks={tweaks} />
                : <ScanTab onScanned={payload => { onScanned(payload); onClose() }} />
              }
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Share Tab ────────────────────────────────────────────────────────────────
function ShareTab({ settings, devices, tweaks }) {
  const [scopes, setScopes] = useState(DEFAULT_SCOPES)
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [error, setError] = useState(null)

  const toggle = (k) => setScopes(s => ({ ...s, [k]: !s[k] }))
  const toggleDevice = (id) => setScopes(s => ({
    ...s,
    devices: s.devices.includes(id) ? s.devices.filter(x => x !== id) : [...s.devices, id],
  }))
  const selectAllDevices = () => setScopes(s => ({
    ...s,
    devices: s.devices.length === devices.length ? [] : devices.map(d => d.id),
  }))

  const handleApiKeyToggle = () => {
    if (scopes.apiKey) { setScopes(s => ({ ...s, apiKey: false })); return }
    const ok = window.confirm(
      '⚠️ คำเตือน: แชร์ API Key\n\n' +
      'ผู้ที่สแกน QR นี้จะใช้เงินในบัญชี LLM ของคุณได้ทันที ' +
      'แชร์เฉพาะกับคนที่ไว้ใจเท่านั้น\n\nเข้าใจและต้องการแชร์ต่อ?'
    )
    if (ok) setScopes(s => ({ ...s, apiKey: true }))
  }

  const hasAnyScope =
    scopes.profile || scopes.llmConfig || scopes.mqtt ||
    scopes.skills || scopes.theme || scopes.devices.length > 0

  useEffect(() => {
    if (!hasAnyScope) { setQrDataUrl(null); setError(null); return }
    const payload = buildPayload({ settings, devices, tweaks, scopes })
    const text = encodePayload(payload)
    QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 320, color: { dark: '#0a0a0a', light: '#ffffff' } })
      .then(url => { setQrDataUrl(url); setError(null) })
      .catch(() => setError('ข้อมูลใหญ่เกินไป ลองเลือกน้อยลง'))
  }, [scopes, settings, devices, tweaks, hasAnyScope])

  return (
    <>
      <p className="sh-modal-hint">เลือกสิ่งที่จะแชร์ ระบบจะสร้าง QR ให้ผู้อื่นสแกนเพื่อ import</p>

      <div className="sh-qr-scopes">
        <ScopeRow label="Profile"      checked={scopes.profile}   onClick={() => toggle('profile')}   sub="ชื่อ, role" />
        <ScopeRow label="LLM Config"   checked={scopes.llmConfig} onClick={() => toggle('llmConfig')} sub="endpoint, model, system prompt" />
        {scopes.llmConfig && (
          <ScopeRow
            label={<>API Key <span className="sh-danger">(อันตราย)</span></>}
            checked={scopes.apiKey}
            onClick={handleApiKeyToggle}
            sub="ต้องยืนยันก่อน"
            indent
          />
        )}
        <ScopeRow label="MQTT Broker"  checked={scopes.mqtt}    onClick={() => toggle('mqtt')}    sub="broker, port, base topic" />
        <ScopeRow label="Skills"       checked={scopes.skills}  onClick={() => toggle('skills')}  sub={`${settings.skills?.length || 0} tools`} />
        <ScopeRow label="Theme"        checked={scopes.theme}   onClick={() => toggle('theme')}   sub="สี, ธีม, density" />

        <div className="sh-qr-devices">
          <div className="sh-qr-devices-head">
            <div className="sh-qr-scope-label">
              Devices <span className="mono sh-qr-count">{scopes.devices.length}/{devices.length}</span>
            </div>
            <button className="sh-qr-selectall mono" onClick={selectAllDevices}>
              {scopes.devices.length === devices.length ? 'clear' : 'select all'}
            </button>
          </div>
          <div className="sh-qr-devicelist">
            {devices.map(d => (
              <button
                key={d.id}
                className={`sh-qr-devicechip ${scopes.devices.includes(d.id) ? 'on' : ''}`}
                onClick={() => toggleDevice(d.id)}
              >
                {d.name} <span className="mono">· {d.room}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sh-qr-display">
        {error && <div className="sh-qr-error"><Icon name="alert" size={12} /> {error}</div>}
        {qrDataUrl ? (
          <>
            <img src={qrDataUrl} alt="share qr" className="sh-qr-img" />
            <div className="sh-qr-display-meta mono">
              ให้ผู้รับสแกนจากปุ่ม "สแกน QR" — ข้อมูลจะ import อัตโนมัติ
            </div>
          </>
        ) : (
          !error && <div className="sh-qr-empty mono">เลือกอย่างน้อย 1 อย่างเพื่อสร้าง QR</div>
        )}
      </div>
    </>
  )
}

function ScopeRow({ label, sub, checked, onClick, indent }) {
  return (
    <button className={`sh-qr-scope ${checked ? 'on' : ''} ${indent ? 'indent' : ''}`} onClick={onClick}>
      <div className={`sh-qr-check ${checked ? 'on' : ''}`}>
        {checked && <Icon name="check" size={11} />}
      </div>
      <div className="sh-qr-scope-meta">
        <div className="sh-qr-scope-label">{label}</div>
        {sub && <div className="sh-qr-scope-sub mono">{sub}</div>}
      </div>
    </button>
  )
}

// ─── Scan Tab ─────────────────────────────────────────────────────────────────
function ScanTab({ onScanned }) {
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef    = useRef(null)
  const [status, setStatus] = useState('init') // init | scanning | error | done
  const [errorMsg, setErrorMsg] = useState(null)

  const stop = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => () => stop(), [stop])

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }, audio: false,
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        setStatus('scanning')
        tick()
      } catch (err) {
        setStatus('error')
        setErrorMsg(err.name === 'NotAllowedError'
          ? 'ไม่ได้อนุญาตให้ใช้กล้อง — กรุณาอนุญาตในเบราว์เซอร์'
          : `เปิดกล้องไม่ได้: ${err.message || err.name}`)
      }
    }

    function tick() {
      const video  = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick); return
      }
      const w = video.videoWidth, h = video.videoHeight
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(video, 0, 0, w, h)
      const imageData = ctx.getImageData(0, 0, w, h)
      const code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' })
      if (code?.data) {
        setStatus('done')
        stop()
        onScanned(code.data)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    start()
    return () => { cancelled = true; stop() }
  }, [onScanned, stop])

  return (
    <>
      <p className="sh-modal-hint">ส่องกล้องไปที่ QR ของระบบ — เมื่อสแกนได้ระบบจะ import ทันที</p>
      <div className="sh-qr-scan">
        <video ref={videoRef} playsInline muted className="sh-qr-video" />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <div className={`sh-qr-scan-frame ${status === 'scanning' ? 'active' : ''}`} />

        <div className={`sh-qr-scan-status mono ${status}`}>
          {status === 'init' && 'กำลังเปิดกล้อง…'}
          {status === 'scanning' && 'กำลังค้นหา QR…'}
          {status === 'done' && 'สแกนสำเร็จ!'}
          {status === 'error' && errorMsg}
        </div>
      </div>
    </>
  )
}
