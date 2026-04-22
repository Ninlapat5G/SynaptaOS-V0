import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import Icon from './ui/Icon'
import { buildPayload, encodePayload, decodePayload } from '../utils/qrshare'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SCOPES = {
  profile:   false,
  llmConfig: false,
  apiKey:    false,
  mqtt:      false,
  skills:    false,
  theme:     false,
  devices:   [],
}

const SCOPE_LABELS = {
  profile:    'Profile',
  llm:        'LLM Config',
  'llm+key':  'LLM Config + API Key',
  mqtt:       'MQTT Broker',
  skills:     'Skills',
  theme:      'Theme',
}

function scopeLabel(scope) {
  if (scope.startsWith('devices(')) return `Devices (${scope.slice(8, -1)} รายการ)`
  return SCOPE_LABELS[scope] || scope
}

// ─── Modal shell ──────────────────────────────────────────────────────────────

export default function QRShareModal({
  open, onClose, mode: initialMode = 'share',
  settings, devices, tweaks, onScanned,
}) {
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
                : <ScanTab onScanned={raw => { onScanned(raw); onClose() }} />
              }
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Share Tab ────────────────────────────────────────────────────────────────

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

function ShareTab({ settings, devices, tweaks }) {
  const [scopes, setScopes]     = useState(DEFAULT_SCOPES)
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [error, setError]       = useState(null)

  const toggle       = k  => setScopes(s => ({ ...s, [k]: !s[k] }))
  const toggleDevice = id => setScopes(s => ({
    ...s,
    devices: s.devices.includes(id) ? s.devices.filter(x => x !== id) : [...s.devices, id],
  }))
  const selectAllDevices = () => setScopes(s => ({
    ...s,
    devices: s.devices.length === devices.length ? [] : devices.map(d => d.id),
  }))

  const handleApiKeyToggle = () => {
    if (scopes.apiKey) { setScopes(s => ({ ...s, apiKey: false })); return }
    if (window.confirm(
      '⚠️ คำเตือน: แชร์ API Key\n\n' +
      'ผู้ที่สแกน QR นี้จะใช้เงินในบัญชี LLM ของคุณได้ทันที ' +
      'แชร์เฉพาะกับคนที่ไว้ใจเท่านั้น\n\nเข้าใจและต้องการแชร์ต่อ?'
    )) setScopes(s => ({ ...s, apiKey: true }))
  }

  const hasAnyScope =
    scopes.profile || scopes.llmConfig || scopes.mqtt ||
    scopes.skills  || scopes.theme     || scopes.devices.length > 0

  useEffect(() => {
    if (!hasAnyScope) { setQrDataUrl(null); setError(null); return }
    const payload = buildPayload({ settings, devices, tweaks, scopes })
    QRCode.toDataURL(encodePayload(payload), {
      errorCorrectionLevel: 'M', margin: 1, width: 320,
      color: { dark: '#0a0a0a', light: '#ffffff' },
    })
      .then(url => { setQrDataUrl(url); setError(null) })
      .catch(() => setError('ข้อมูลใหญ่เกินไป ลองเลือกน้อยลง'))
  }, [scopes, settings, devices, tweaks, hasAnyScope])

  return (
    <>
      <p className="sh-modal-hint">เลือกสิ่งที่จะแชร์ ระบบจะสร้าง QR ให้ผู้อื่นสแกนเพื่อ import</p>

      <div className="sh-qr-scopes">
        <ScopeRow label="Profile"    checked={scopes.profile}   onClick={() => toggle('profile')}   sub="ชื่อผู้ใช้" />
        <ScopeRow label="LLM Config" checked={scopes.llmConfig} onClick={() => toggle('llmConfig')} sub="endpoint, model, system prompt" />
        {scopes.llmConfig && (
          <ScopeRow
            label={<>API Key <span className="sh-danger">(อันตราย)</span></>}
            checked={scopes.apiKey}
            onClick={handleApiKeyToggle}
            sub="ต้องยืนยันก่อน"
            indent
          />
        )}
        <ScopeRow label="MQTT Broker" checked={scopes.mqtt}   onClick={() => toggle('mqtt')}   sub="broker, port, base topic" />
        <ScopeRow label="Skills"      checked={scopes.skills} onClick={() => toggle('skills')} sub={`${settings.skills?.length || 0} tools`} />
        <ScopeRow label="Theme"       checked={scopes.theme}  onClick={() => toggle('theme')}  sub="สี, ธีม, density" />

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
        {qrDataUrl
          ? <>
              <img src={qrDataUrl} alt="share qr" className="sh-qr-img" />
              <div className="sh-qr-display-meta mono">
                ให้ผู้รับสแกนจากปุ่ม "สแกน QR" — ข้อมูลจะ import อัตโนมัติ
              </div>
            </>
          : !error && <div className="sh-qr-empty mono">เลือกอย่างน้อย 1 อย่างเพื่อสร้าง QR</div>
        }
      </div>
    </>
  )
}

// ─── Scan Result Overlay ──────────────────────────────────────────────────────

function ScanResultOverlay({ result, onConfirm, onDismiss }) {
  return (
    <motion.div
      className="sh-scan-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        className={`sh-scan-result ${result.ok ? 'success' : 'error'}`}
        initial={{ scale: 0.82, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 10 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      >
        <div className={`sh-scan-result-icon ${result.ok ? 'success' : 'error'}`}>
          <Icon name={result.ok ? 'check' : 'alert'} size={28} />
        </div>

        <div className="sh-scan-result-title">
          {result.ok ? 'QR ถูกต้อง' : 'สแกนล้มเหลว'}
        </div>

        {result.ok && result.payload?.scope?.length > 0 && (
          <div className="sh-scan-result-scopes">
            {result.payload.scope.map((s, i) => (
              <span key={i} className="sh-scan-result-chip mono">{scopeLabel(s)}</span>
            ))}
          </div>
        )}

        {!result.ok && (
          <p className="sh-scan-result-msg mono">
            {result.error || 'QR Code ไม่ตรงกับรูปแบบของระบบ'}
          </p>
        )}

        <div className="sh-scan-result-actions">
          {result.ok
            ? <>
                <button className="sh-btn-ghost" onClick={onDismiss}>ยกเลิก</button>
                <button className="sh-btn-primary" onClick={onConfirm}>Import เลย</button>
              </>
            : <button className="sh-btn-ghost" onClick={onDismiss}>ลองใหม่</button>
          }
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Scan Tab ─────────────────────────────────────────────────────────────────

function ScanTab({ onScanned }) {
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef    = useRef(null)
  const fileRef   = useRef(null)

  const [camStatus, setCamStatus]     = useState('init') // init | scanning | error
  const [camError, setCamError]       = useState(null)
  const [cameraKey, setCameraKey]     = useState(0)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [scanResult, setScanResult]   = useState(null)
  const [fileLoading, setFileLoading] = useState(false)

  const stopCamera = useCallback(() => {
    if (rafRef.current)   { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (streamRef.current){ streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  // Validate raw QR text and show result overlay
  const handleDetected = useCallback((rawText, source = 'camera') => {
    if (source === 'camera') stopCamera()
    const decoded = decodePayload(rawText)
    setScanResult(decoded.ok
      ? { ok: true, rawText, payload: decoded.payload, source }
      : { ok: false, error: decoded.error, source },
    )
  }, [stopCamera])

  // Camera loop — restarts when cameraKey changes
  useEffect(() => {
    if (scanResult) return
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        setCamStatus('scanning')
        tick()
      } catch (err) {
        if (cancelled) return
        setCamStatus('error')
        setCamError(err.name === 'NotAllowedError'
          ? 'ไม่ได้อนุญาตให้ใช้กล้อง — กรุณาอนุญาตในเบราว์เซอร์'
          : `เปิดกล้องไม่ได้: ${err.message || err.name}`,
        )
      }
    }

    function tick() {
      if (cancelled) return
      const video  = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return }
      const { videoWidth: w, videoHeight: h } = video
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(video, 0, 0, w, h)
      const imageData = ctx.getImageData(0, 0, w, h)
      const code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' })
      if (code?.data) { handleDetected(code.data, 'camera'); return }
      rafRef.current = requestAnimationFrame(tick)
    }

    start()
    return () => { cancelled = true; stopCamera() }
  }, [cameraKey, scanResult, handleDetected, stopCamera])

  // Decode QR from image file
  const handleFileUpload = useCallback(async e => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileLoading(true)
    stopCamera()
    try {
      const bitmap = await createImageBitmap(file)
      const cvs = document.createElement('canvas')
      cvs.width = bitmap.width; cvs.height = bitmap.height
      const ctx = cvs.getContext('2d')
      ctx.drawImage(bitmap, 0, 0)
      const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' })
      if (!code?.data) {
        setScanResult({ ok: false, error: 'ไม่พบ QR Code ในรูปภาพ', source: 'file' })
      } else {
        handleDetected(code.data, 'file')
      }
    } catch {
      setScanResult({ ok: false, error: 'อ่านรูปภาพไม่ได้', source: 'file' })
    } finally {
      setFileLoading(false)
    }
  }, [handleDetected, stopCamera])

  const handleConfirm = () => { if (scanResult?.ok) onScanned(scanResult.rawText) }

  const handleDismiss = () => {
    setScanResult(null)
    setFileInputKey(k => k + 1)
    setCamStatus('init')
    setCameraKey(k => k + 1)
  }

  return (
    <>
      <p className="sh-modal-hint">
        ส่องกล้องไปที่ QR ของระบบ — หรือเลือกรูปภาพจากเครื่อง
      </p>

      <div className="sh-qr-scan" style={{ position: 'relative' }}>
        <video ref={videoRef} playsInline muted className="sh-qr-video" />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <div className={`sh-qr-scan-frame ${camStatus === 'scanning' ? 'active' : ''}`} />
        <div className={`sh-qr-scan-status mono ${camStatus}`}>
          {camStatus === 'init'     && 'กำลังเปิดกล้อง…'}
          {camStatus === 'scanning' && 'กำลังค้นหา QR…'}
          {camStatus === 'error'    && camError}
        </div>

        <AnimatePresence>
          {scanResult && (
            <ScanResultOverlay
              result={scanResult}
              onConfirm={handleConfirm}
              onDismiss={handleDismiss}
            />
          )}
        </AnimatePresence>
      </div>

      <div className="sh-qr-upload-row">
        <div className="sh-qr-upload-divider mono">— หรือ —</div>
        <button
          className="sh-qr-upload-btn"
          onClick={() => fileRef.current?.click()}
          disabled={fileLoading}
        >
          <Icon name={fileLoading ? 'sparkle' : 'image'} size={15} />
          {fileLoading ? 'กำลังอ่านรูป…' : 'เลือกรูปภาพจากเครื่อง'}
        </button>
        <input
          key={fileInputKey}
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />
      </div>
    </>
  )
}
