import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import { INITIAL_TWEAKS } from './data'
import { clearAll } from './utils/storage'
import { normalizeBase, buildFullTopic } from './utils/mqttTopic'
import { generateOsCommand } from './utils/agent'
import { createExecuteTool } from './utils/agentSkills'

import { useMQTT } from './hooks/useMQTT'
import { useChat } from './hooks/useChat'
import { useSettings } from './hooks/useSettings'
import { useDevices } from './hooks/useDevices'
import { useAreas } from './hooks/useAreas'
import { useOnboarding } from './hooks/useOnboarding'
import { loadOnboarding } from './utils/storage'

import Nav, { MobileTopbar, MobileBottomNav } from './components/Nav'
import DeviceCard, { AddDeviceTile, AddTerminalTile, AddHubTile } from './components/DeviceCard'
import ChatPage from './components/ChatPage'
import SettingsPage from './components/SettingsPage'
import TweaksPanel from './components/TweaksPanel'
import ErrorBoundary from './components/ErrorBoundary'
import Icon from './components/ui/Icon'

const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.15 } },
}

const gridVariants = {
  animate: { transition: { staggerChildren: 0.06 } },
}

export default function App() {
  const [tweaks, setTweaks] = useState(INITIAL_TWEAKS)
  const [tweaksOpen, setTweaksOpen] = useState(false)
  const [page, setPage] = useState(() => localStorage.getItem('sh-page') || 'devices')
  const [chatDraft, setChatDraft] = useState('')
  const [mobileNavOpen, setMobileNav] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => { localStorage.setItem('sh-page', page) }, [page])

  // ── Redirect to chat on first visit (while onboarding not complete) ──────────
  useEffect(() => {
    const saved = loadOnboarding()
    if (!saved?.completed) setPage('chat')
  }, []) // eslint-disable-line

  // ── Settings ──────────────────────────────────────────────────────────────────
  const { settings, handleSaveSettings, baseTopicRef } = useSettings()

  // ── Devices ───────────────────────────────────────────────────────────────────
  const { devices, setDevices, devicesRef, handleMqttMessage, removeDevice } = useDevices({ baseTopicRef })

  // ── MQTT ──────────────────────────────────────────────────────────────────────
  const { client: mqttClient, status: mqttStatus, sensorCache, publish: mqttPublish,
    waitForMessage: mqttWaitForMessage, waitForStream: mqttWaitForStream } = useMQTT({
    broker: settings.mqtt.broker,
    port: settings.mqtt.port,
    baseTopic: settings.mqtt.baseTopic,
    onMessage: handleMqttMessage,
  })

  // ── Areas ─────────────────────────────────────────────────────────────────────
  const { areas, setAreas, activeArea, setActiveArea, editAreas, setEditAreas, newArea, setNewArea } = useAreas()

  // ── Device update (needs both setDevices + mqttPublish → stays here) ──────────
  const updateDevice = useCallback((next, isFinal = true) => {
    setDevices(prev => prev.map(d => d.id === next.id ? next : d))
    if (isFinal && next.pubTopic) {
      const payload = next.type === 'digital' ? (next.on ? 'true' : 'false') : String(next.value)
      mqttPublish(next.pubTopic, payload)
    }
  }, [mqttPublish, setDevices])

  // ── Tool executor ─────────────────────────────────────────────────────────────
  const executeTool = useCallback(
    createExecuteTool({
      mqttClient, sensorCache, settings, mqttWaitForMessage, mqttWaitForStream,
      devicesRef, baseTopicRef, setDevices,
      normalizeBase, buildFullTopic, generateOsCommand,
      handleSaveSettings,
    }),
    [mqttClient, sensorCache, settings, mqttWaitForMessage, mqttWaitForStream, handleSaveSettings]
  )

  // ── Raw MQTT publish (used by DeviceCard terminal widget) ─────────────────────
  const handleRawPublish = useCallback((topic, payload) => {
    if (!mqttClient || !topic) return
    const base = normalizeBase(baseTopicRef.current)
    const fullTopic = buildFullTopic(topic, base)
    mqttClient.publish(fullTopic, String(payload), { qos: 2 })
  }, [mqttClient])

  // ── Chat ──────────────────────────────────────────────────────────────────────
  const { messages, thinking, executing, sendMessage, clearChat, stopChat } = useChat({
    settings,
    devicesRef,
    executeTool,
  })

  // ── Onboarding ────────────────────────────────────────────────────────────────
  const onboarding = useOnboarding({
    settings,
    handleSaveSettings,
    onComplete: useCallback(() => setPage('chat'), []),
  })

  // Trigger ซิน greeting when user lands on chat page
  useEffect(() => {
    if (page === 'chat' && onboarding.active) {
      onboarding.triggerGreeting()
    }
  }, [page, onboarding.active]) // eslint-disable-line

  // ── Theme tokens ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = tweaks.theme
    root.dataset.density = tweaks.density
    root.dataset.grid = tweaks.showGrid ? 'on' : 'off'
    root.style.setProperty('--accent-h', tweaks.accentHue)
    root.style.setProperty('--accent-c', tweaks.accentChroma)
  }, [tweaks])

  // ── Offline toast ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const showToast = (type, text) => {
      setToast({ type, text })
      setTimeout(() => setToast(null), type === 'error' ? 5000 : 3000)
    }
    const onOffline = () => showToast('error', 'ออฟไลน์ — ไม่สามารถควบคุมอุปกรณ์ได้')
    const onOnline  = () => showToast('ok',    'เชื่อมต่ออินเตอร์เน็ตแล้ว')
    window.addEventListener('offline', onOffline)
    window.addEventListener('online',  onOnline)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online',  onOnline)
    }
  }, [])

  const handleClearAll = useCallback(() => { clearAll(); window.location.reload() }, [])

  // ── Derived stats ─────────────────────────────────────────────────────────────
  const activeCount  = devices.filter(d => d.type === 'digital' ? d.on : d.value > 0).length
  const analogDevices = devices.filter(d => d.type === 'analog')
  const analogAvg    = analogDevices.length
    ? Math.round(analogDevices.reduce((a, d) => a + d.value, 0) / analogDevices.length)
    : 0
  const roomCount    = new Set(devices.map(d => d.room)).size
  const skillCount   = (settings.skills || []).filter(s => s.enabled).length
  const modelShort   = (settings.model || 'typhoon-v2').split('-instruct')[0]
  const visibleDevices = devices.filter(d => activeArea === 'All' || d.room === activeArea)
  const mqttUnhealthy  = mqttStatus === 'reconnecting' || mqttStatus === 'error'

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="sh-app">
      <MobileTopbar
        page={page}
        onOpenMenu={() => setMobileNav(true)}
        tweaks={tweaks}
        onToggleTheme={() => setTweaks(t => ({ ...t, theme: t.theme === 'dark' ? 'light' : 'dark' }))}
      />

      <div className="sh-app-body">
        <Nav
          page={page} setPage={setPage}
          activeCount={activeCount} deviceCount={devices.length}
          tweaks={tweaks}
          onToggleTheme={() => setTweaks(t => ({ ...t, theme: t.theme === 'dark' ? 'light' : 'dark' }))}
          onToggleTweaks={() => setTweaksOpen(v => !v)}
          tweaksOpen={tweaksOpen}
          profile={settings.profile}
          mqttStatus={mqttStatus}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNav(false)}
        />

        <main className="sh-main">
          {mqttUnhealthy && (
            <div className={`sh-mqtt-banner ${mqttStatus === 'error' ? 'error' : ''}`}>
              <span style={{ animation: 'pulse-dot 1s ease-in-out infinite', display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
              {mqttStatus === 'reconnecting' ? '↻ กำลังเชื่อมต่อ MQTT ใหม่...' : '⚠ MQTT เกิดข้อผิดพลาด — ตรวจสอบ Settings'}
            </div>
          )}

          <AnimatePresence mode="wait">
            {page === 'devices' && (
              <motion.section key="devices" className="sh-board" {...pageVariants}>
                <div className="sh-page-head">
                  <div>
                    <div className="sh-eyebrow mono">WIDGET BOARD</div>
                    <h1>Devices <span className="sh-h1-count mono">{devices.length}</span></h1>
                    <p className="sh-page-sub">
                      {activeCount} active · {roomCount} rooms · avg {analogAvg}/255
                    </p>
                  </div>
                  <div className="sh-board-filters mono">
                    {['All', ...areas].map(f => (
                      <span key={f} className={`sh-filter-chip ${activeArea === f ? 'on' : ''}`}>
                        <button className="sh-filter-btn" onClick={() => setActiveArea(f)}>{f}</button>
                        {editAreas && f !== 'All' && (
                          <button
                            className="sh-filter-x"
                            onClick={() => {
                              setAreas(areas.filter(a => a !== f))
                              if (activeArea === f) setActiveArea('All')
                            }}
                          >
                            <Icon name="close" size={10} />
                          </button>
                        )}
                      </span>
                    ))}
                    {editAreas && (
                      <form
                        className="sh-filter-add"
                        onSubmit={e => {
                          e.preventDefault()
                          const v = newArea.trim()
                          if (v && !areas.includes(v)) setAreas([...areas, v])
                          setNewArea('')
                        }}
                      >
                        <input
                          value={newArea}
                          onChange={e => setNewArea(e.target.value)}
                          placeholder="New area…"
                        />
                        <button type="submit" disabled={!newArea.trim()}>
                          <Icon name="plus" size={11} />
                        </button>
                      </form>
                    )}
                    <button
                      className={`sh-filter-edit ${editAreas ? 'on' : ''}`}
                      onClick={() => setEditAreas(v => !v)}
                    >
                      {editAreas ? 'Done' : 'Edit'}
                    </button>
                  </div>
                </div>

                <ErrorBoundary>
                  <motion.div className="sh-grid" variants={gridVariants} initial="hidden" animate="visible">
                    {visibleDevices.map(d => (
                      <DeviceCard
                        key={d.id}
                        device={d}
                        onUpdate={updateDevice}
                        onRemove={removeDevice}
                        areas={areas}
                        onRawPublish={handleRawPublish}
                      />
                    ))}
                    <AddDeviceTile
                      onClick={() => {
                        const id = 'dev-' + Date.now().toString(36)
                        setDevices(prev => [...prev, {
                          id, name: 'New Device', room: areas[0] || 'Living Room',
                          type: 'digital', on: false, icon: 'bulb',
                          pubTopic: `${id}/set`,
                          subTopic: `${id}/state`,
                        }])
                      }}
                    />
                    <AddTerminalTile
                      defaultArea={areas[0] || 'Living Room'}
                      onCreate={device => setDevices(prev => [...prev, device])}
                    />
                    <AddHubTile
                      defaultArea={areas[0] || 'Living Room'}
                      onCreate={device => setDevices(prev => [...prev, device])}
                    />
                  </motion.div>
                </ErrorBoundary>

                <footer className="sh-board-foot mono">
                  <span>◀ · {devices.length} devices across {roomCount} rooms</span>
                  <span className="flex-1" />
                  <span>MQTT: {settings.mqtt.broker}:{settings.mqtt.port}</span>
                </footer>
              </motion.section>
            )}

            {page === 'chat' && (
              <motion.div key="chat" className="h-full" {...pageVariants}>
                <ErrorBoundary>
                  <ChatPage
                    messages={onboarding.active ? onboarding.messages : messages}
                    onSend={onboarding.active ? onboarding.send : sendMessage}
                    onStop={stopChat}
                    thinking={onboarding.active ? onboarding.thinking : thinking}
                    executing={onboarding.active ? [] : executing}
                    onClear={onboarding.active ? null : clearChat}
                    modelName={modelShort}
                    skillCount={skillCount}
                    msgCount={onboarding.active
                      ? onboarding.messages.filter(m => m.role === 'user').length
                      : messages.filter(m => m.role === 'user').length}
                    draft={chatDraft}
                    onDraftChange={setChatDraft}
                    assistantName={onboarding.active ? 'ซิน' : (settings.profile?.assistantName || 'ซิน')}
                  />
                </ErrorBoundary>
              </motion.div>
            )}

            {page === 'settings' && (
              <motion.div key="settings" {...pageVariants}>
                <ErrorBoundary>
                  <SettingsPage
                    settings={settings}
                    onSave={handleSaveSettings}
                    mqttStatus={mqttStatus}
                    onClearAll={handleClearAll}
                  />
                </ErrorBoundary>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <MobileBottomNav
        page={page} setPage={setPage}
        activeCount={activeCount} deviceCount={devices.length}
      />
      <TweaksPanel open={tweaksOpen} tweaks={tweaks} onChange={patch => setTweaks(t => ({ ...t, ...patch }))} />

      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            className={`sh-toast ${toast.type}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
          >
            <Icon name={toast.type === 'ok' ? 'check' : 'alert'} size={14} />
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
