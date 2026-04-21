// ── QR Share payload (encode/decode/pattern) ──────────────────────────────────
// Pattern header lets the scanner identify our own QR codes and route the data
// to the right part of the app — rejecting anything that doesn't match.

export const PAYLOAD_TAG = 'aiot-share'
export const PAYLOAD_VERSION = 1

// base64 that survives URL and QR encoding without needing padding tricks
const b64encode = str => {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
const b64decode = str => {
  const bin = atob(str)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// Build a share payload from current app state + selected scopes.
// scopes: { profile, llmConfig, apiKey, mqtt, devices (array of ids | 'all'), skills, theme }
export function buildPayload({ settings, devices, tweaks, scopes }) {
  const data = {}
  const includedScopes = []

  if (scopes.profile && settings.profile) {
    data.profile = settings.profile
    includedScopes.push('profile')
  }
  if (scopes.llmConfig) {
    data.llm = {
      endpoint: settings.endpoint,
      model: settings.model,
      systemPrompt: settings.systemPrompt,
    }
    if (scopes.apiKey && settings.apiKey) data.llm.apiKey = settings.apiKey
    includedScopes.push(scopes.apiKey ? 'llm+key' : 'llm')
  }
  if (scopes.mqtt && settings.mqtt) {
    data.mqtt = settings.mqtt
    includedScopes.push('mqtt')
  }
  if (scopes.skills && settings.skills) {
    data.skills = settings.skills
    includedScopes.push('skills')
  }
  if (scopes.theme && tweaks) {
    data.tweaks = tweaks
    includedScopes.push('theme')
  }
  if (scopes.devices && Array.isArray(scopes.devices) && scopes.devices.length) {
    const selected = scopes.devices === 'all'
      ? devices
      : devices.filter(d => scopes.devices.includes(d.id))
    if (selected.length) {
      data.devices = selected
      includedScopes.push(`devices(${selected.length})`)
    }
  }

  return {
    _t: PAYLOAD_TAG,
    v:  PAYLOAD_VERSION,
    scope: includedScopes,
    data,
  }
}

export function encodePayload(payload) {
  return b64encode(JSON.stringify(payload))
}

export function decodePayload(text) {
  let parsed
  try {
    const json = b64decode(text.trim())
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, error: 'ไม่ใช่ QR ของระบบ (decode ไม่ได้)' }
  }
  if (parsed?._t !== PAYLOAD_TAG) {
    return { ok: false, error: 'ไม่ใช่ QR ของระบบ (pattern ไม่ตรง)' }
  }
  if (parsed.v !== PAYLOAD_VERSION) {
    return { ok: false, error: `QR version ${parsed.v} ไม่รองรับ (ต้องการ v${PAYLOAD_VERSION})` }
  }
  return { ok: true, payload: parsed }
}

// Merge imported payload into current state. Skips devices with duplicate IDs.
// Returns { settings, devices, tweaks, summary: string[] }.
export function applyPayload({ payload, settings, devices, tweaks }) {
  const d = payload.data || {}
  const summary = []
  let nextSettings = settings
  let nextDevices  = devices
  let nextTweaks   = tweaks

  if (d.profile) {
    nextSettings = { ...nextSettings, profile: { ...nextSettings.profile, ...d.profile } }
    summary.push('Profile')
  }
  if (d.llm) {
    nextSettings = {
      ...nextSettings,
      endpoint: d.llm.endpoint ?? nextSettings.endpoint,
      model:    d.llm.model ?? nextSettings.model,
      systemPrompt: d.llm.systemPrompt ?? nextSettings.systemPrompt,
      ...(d.llm.apiKey ? { apiKey: d.llm.apiKey } : {}),
    }
    summary.push(d.llm.apiKey ? 'LLM config + API key' : 'LLM config')
  }
  if (d.mqtt) {
    nextSettings = { ...nextSettings, mqtt: { ...nextSettings.mqtt, ...d.mqtt } }
    summary.push('MQTT broker')
  }
  if (d.skills) {
    nextSettings = { ...nextSettings, skills: d.skills }
    summary.push(`Skills (${d.skills.length})`)
  }
  if (d.tweaks) {
    nextTweaks = { ...nextTweaks, ...d.tweaks }
    summary.push('Theme')
  }
  if (Array.isArray(d.devices) && d.devices.length) {
    const existingIds = new Set(nextDevices.map(x => x.id))
    const fresh = d.devices.filter(x => !existingIds.has(x.id))
    const skipped = d.devices.length - fresh.length
    if (fresh.length) nextDevices = [...nextDevices, ...fresh]
    summary.push(
      skipped
        ? `Devices: +${fresh.length} (ข้าม ${skipped} ID ซ้ำ)`
        : `Devices: +${fresh.length}`,
    )
  }

  return { settings: nextSettings, devices: nextDevices, tweaks: nextTweaks, summary }
}
