import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import Icon from './ui/Icon'
import Toggle from './ui/Toggle'

export default function SettingsPage({ settings, onSave }) {
  const [s, setS] = useState(settings)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { setS(settings); setDirty(false) }, [settings])

  const set    = (k, v) => { setS(p => ({ ...p, [k]: v })); setDirty(true); setSaved(false) }
  const setMq  = (k, v) => { setS(p => ({ ...p, mqtt: { ...p.mqtt, [k]: v } })); setDirty(true); setSaved(false) }
  const setPro = (k, v) => { setS(p => ({ ...p, profile: { ...p.profile, [k]: v } })); setDirty(true); setSaved(false) }

  const toggleSkill = id =>
    setS(p => ({ ...p, skills: p.skills.map(sk => sk.id === id ? { ...sk, enabled: !sk.enabled } : sk) }))

  const updateSkill = (id, patch) =>
    setS(p => ({ ...p, skills: p.skills.map(sk => sk.id === id ? { ...sk, ...patch } : sk) }))

  const addSkill = () => {
    const id = 'skill-' + Date.now().toString(36)
    setS(p => ({
      ...p,
      skills: [...p.skills, { id, name: 'new_tool', description: 'Describe what this tool does.', enabled: true, schema: '{"type":"object","properties":{}}' }],
    }))
    setDirty(true)
  }

  const removeSkill = id =>
    setS(p => ({ ...p, skills: p.skills.filter(sk => sk.id !== id) }))

  const handleSave = () => {
    onSave(s)
    setDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <motion.div
      className="sh-settings-page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="sh-settings-frame">
        <div className="sh-page-head">
          <div>
            <div className="sh-eyebrow mono">SYSTEM · CONFIGURATION</div>
            <h1>Settings</h1>
            <p className="sh-page-sub">ค่าต่างๆ ถูกบันทึกเป็น cookie ในเบราว์เซอร์</p>
          </div>
          <div className="sh-settings-actions">
            <button className="sh-btn-ghost" onClick={() => { setS(settings); setDirty(false) }} disabled={!dirty}>
              Discard
            </button>
            <button className="sh-btn-primary" onClick={handleSave} disabled={!dirty}>
              {saved ? <><Icon name="check" size={14} /> Saved</> : dirty ? 'Save configuration' : 'Saved'}
            </button>
          </div>
        </div>

        <div className="sh-settings-body">
          {/* 01 Profile */}
          <section className="sh-sect">
            <div className="sh-sect-head">
              <div className="sh-sect-num mono">01</div>
              <div><h3>Profile</h3><p>ชื่อและบทบาทของผู้ใช้งาน</p></div>
            </div>
            <div className="sh-grid2">
              <div className="sh-field">
                <label className="mono">Display Name</label>
                <input value={s.profile?.name || ''} onChange={e => setPro('name', e.target.value)} placeholder="Your name" />
              </div>
              <div className="sh-field">
                <label className="mono">Role</label>
                <input value={s.profile?.role || ''} onChange={e => setPro('role', e.target.value)} placeholder="Owner" />
              </div>
            </div>
          </section>

          {/* 02 LLM */}
          <section className="sh-sect">
            <div className="sh-sect-head">
              <div className="sh-sect-num mono">02</div>
              <div><h3>Language Model</h3><p>Endpoint ที่ใช้สื่อสารกับ AI — รองรับ OpenAI-compatible API</p></div>
            </div>
            <div className="sh-field">
              <label className="mono">API Endpoint</label>
              <input value={s.endpoint} onChange={e => set('endpoint', e.target.value)} placeholder="https://api.opentyphoon.ai/v1" />
            </div>
            <div className="sh-grid2">
              <div className="sh-field">
                <label className="mono">API Key</label>
                <input type="password" value={s.apiKey} onChange={e => set('apiKey', e.target.value)} placeholder="sk-•••••••••••••••••" />
              </div>
              <div className="sh-field">
                <label className="mono">Model</label>
                <input value={s.model || ''} onChange={e => set('model', e.target.value)} placeholder="typhoon-v2-70b-instruct" />
              </div>
            </div>
            <div className="sh-field">
              <label className="mono">System Prompt</label>
              <textarea rows={6} value={s.systemPrompt} onChange={e => set('systemPrompt', e.target.value)} />
            </div>
          </section>

          {/* 03 Skills */}
          <section className="sh-sect">
            <div className="sh-sect-head">
              <div className="sh-sect-num mono">03</div>
              <div>
                <h3>
                  Skills{' '}
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-xdim)', marginLeft: 6 }}>
                    {s.skills?.filter(x => x.enabled).length || 0}/{s.skills?.length || 0} ENABLED
                  </span>
                </h3>
                <p>Tools เสริมที่ AI เรียกได้ · <strong>mqtt_read</strong> และ <strong>mqtt_publish</strong> รองรับ real-time</p>
              </div>
            </div>
            <div className="sh-builtin-note mono">
              <Icon name="bolt" size={11} /> Built-in (ไม่สามารถปิดได้): <strong>device_list</strong> · <strong>device_set_state</strong>
            </div>
            <div className="sh-skills">
              {(s.skills || []).map(sk => (
                <div key={sk.id} className={`sh-skill ${sk.enabled ? 'on' : 'off'}`}>
                  <div className="sh-skill-head">
                    <div className="sh-skill-meta">
                      <div className="sh-skill-name mono">{sk.name}</div>
                      <div className="sh-skill-desc">{sk.description}</div>
                    </div>
                    <Toggle on={sk.enabled} onChange={() => toggleSkill(sk.id)} />
                  </div>
                  <details className="sh-skill-details">
                    <summary className="mono">Edit definition</summary>
                    <div className="sh-grid2 mt-2">
                      <div className="sh-field">
                        <label className="mono">Name</label>
                        <input value={sk.name} onChange={e => updateSkill(sk.id, { name: e.target.value })} />
                      </div>
                      <div className="sh-field">
                        <label className="mono">&nbsp;</label>
                        <button className="sh-card-remove" onClick={() => removeSkill(sk.id)}>Remove skill</button>
                      </div>
                    </div>
                    <div className="sh-field">
                      <label className="mono">Description</label>
                      <input value={sk.description} onChange={e => updateSkill(sk.id, { description: e.target.value })} />
                    </div>
                    <div className="sh-field">
                      <label className="mono">JSON Schema (parameters)</label>
                      <textarea
                        rows={3}
                        value={sk.schema}
                        onChange={e => updateSkill(sk.id, { schema: e.target.value })}
                        className="font-mono text-[11px]"
                      />
                    </div>
                  </details>
                </div>
              ))}
              <button className="sh-skill-add" onClick={addSkill}>
                <Icon name="plus" size={14} /> Add skill
              </button>
            </div>
          </section>

          {/* 04 MQTT */}
          <section className="sh-sect">
            <div className="sh-sect-head">
              <div className="sh-sect-num mono">04</div>
              <div><h3>MQTT Broker</h3><p>Event bus สำหรับรับ/ส่งสัญญาณอุปกรณ์ แบบ real-time</p></div>
            </div>
            <div className="sh-grid2">
              <div className="sh-field">
                <label className="mono">Broker URL</label>
                <input value={s.mqtt.broker} onChange={e => setMq('broker', e.target.value)} />
              </div>
              <div className="sh-field">
                <label className="mono">Port</label>
                <input value={s.mqtt.port} onChange={e => setMq('port', e.target.value)} />
              </div>
            </div>
            <div className="sh-field">
              <label className="mono">Base Topic</label>
              <input value={s.mqtt.baseTopic || ''} onChange={e => setMq('baseTopic', e.target.value)} />
            </div>
            <div className="sh-status-row mono">
              <span className="sh-dot-live" /> BROKER ONLINE · ws/8000 · real-time subscribed
            </div>
          </section>
        </div>
      </div>
    </motion.div>
  )
}
