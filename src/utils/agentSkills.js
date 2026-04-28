// ── Skill Tool Handlers ────────────────────────────────────────────────────────
// Each handler: async (args, ctx) => result
// ctx = { mqttClient, sensorCache, settings, mqttWaitForMessage,
//          devicesRef, baseTopicRef, setDevices,
//          normalizeBase, buildFullTopic, generateOsCommand }
// Note: synthesizeSearch has been removed — web_search now formats results
//       directly as plain text and passes everything to the responder LLM.
//
// To add a new skill:
//   1. Add a handler function below
//   2. Register it in toolHandlers map
//   3. Add its definition to DEFAULT_SETTINGS.skills in data.js

const SERPER_URL = 'https://google.serper.dev/search'

async function mqttPublish(args, ctx) {
  const { mqttClient, devicesRef, baseTopicRef, setDevices, normalizeBase, buildFullTopic } = ctx

  if (!mqttClient) return { success: false, error: 'MQTT not connected' }

  const { topic, payload } = args
  const device = devicesRef.current.find(
    d => d.pubTopic === topic || d.pubTopic?.endsWith('/' + topic)
  )
  const rawTopic = device ? device.pubTopic : topic
  const base = normalizeBase(baseTopicRef.current)
  const fullTopic = buildFullTopic(rawTopic, base)

  return new Promise(resolve => {
    mqttClient.publish(fullTopic, String(payload), { qos: 2 }, err => {
      if (err) { resolve({ success: false, error: err.message }); return }
      if (device) {
        setDevices(prev => prev.map(d => {
          if (d.id !== device.id) return d
          if (d.type === 'digital') return { ...d, on: payload === 'true' }
          if (d.type === 'analog')  return { ...d, value: parseInt(payload, 10) || 0 }
          return d
        }))
      }
      resolve({ success: true, topic: fullTopic, payload, message: 'Published.' })
    })
  })
}

async function mqttRead(args, ctx) {
  const { sensorCache, baseTopicRef, normalizeBase, buildFullTopic } = ctx

  const topic = typeof args === 'string' ? args.trim() : args?.topic
  if (!topic) return { success: false, error: 'No topic specified' }

  const base = normalizeBase(baseTopicRef.current)
  const fullTopic = buildFullTopic(topic, base)
  const val = sensorCache[fullTopic]

  if (val !== undefined) return { success: true, topic: fullTopic, value: val }
  return { success: false, note: `No data cached for topic: ${fullTopic}` }
}

async function osCommand(args, ctx) {
  const { mqttClient, settings, devicesRef, baseTopicRef,
          mqttWaitForMessage, normalizeBase, buildFullTopic, generateOsCommand } = ctx

  const { instruction, os, topic, wait_output } = args
  if (!mqttClient)                      return { success: false, error: 'MQTT not connected' }
  if (!instruction || !os || !topic)    return { success: false, error: 'Missing args: instruction, os, topic' }

  let command
  try {
    command = await generateOsCommand({ settings, instruction, os })
  } catch (err) {
    return { success: false, error: err.message }
  }

  const base = normalizeBase(baseTopicRef.current)
  const fullTopic = buildFullTopic(topic, base)
  const device = devicesRef.current.find(
    d => d.pubTopic === topic || buildFullTopic(d.pubTopic, base) === fullTopic
  )
  const outputTopic = wait_output && device?.subTopic
    ? buildFullTopic(device.subTopic, base)
    : null

  try {
    await new Promise((resolve, reject) =>
      mqttClient.publish(fullTopic, command, { qos: 2 }, err => err ? reject(err) : resolve())
    )
  } catch (err) {
    return { success: false, error: err.message }
  }

  const output = outputTopic ? await mqttWaitForMessage(outputTopic, 10000) : null
  return { success: true, topic: fullTopic, command, os, ...(output != null && { output }) }
}

async function webSearch(args, ctx) {
  const { settings } = ctx
  const { query } = args

  if (!query) return { success: false, error: 'No search query provided' }

  const apiKey = settings.serperApiKey
  if (!apiKey) return { success: false, error: 'Serper API key ยังไม่ได้ตั้งค่า — ไปที่ Settings → Integrations' }

  let res
  try {
    res = await fetch(SERPER_URL, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5 }),
    })
  } catch (err) {
    return { success: false, error: `Network error: ${err.message}` }
  }

  if (res.status === 403) return { success: false, error: 'Serper API key ไม่ถูกต้อง หรือ quota หมดแล้ว — ตรวจสอบที่ serper.dev/dashboard' }
  if (res.status === 429) return { success: false, error: 'Serper API rate limit exceeded — ลองใหม่อีกสักครู่' }
  if (!res.ok)            return { success: false, error: `Serper API error: HTTP ${res.status}` }

  const data = await res.json()

  // Format results as plain text — keep all content, strip JSON structure
  // Responder LLM receives everything and picks out what's relevant itself
  const parts = []

  if (data.answerBox?.answer)
    parts.push(data.answerBox.answer)
  else if (data.answerBox?.snippet)
    parts.push(data.answerBox.snippet)

  if (data.knowledgeGraph?.description)
    parts.push(`${data.knowledgeGraph.title}: ${data.knowledgeGraph.description}`)

  const organic = (data.organic || []).slice(0, 5)
  if (organic.length)
    parts.push(organic.map(r => `${r.title}\n${r.snippet}\n${r.link}`).join('\n\n'))

  const summary = parts.join('\n\n') || 'No results found'
  return { success: true, query, summary }
}

// ── Registry ───────────────────────────────────────────────────────────────────

const toolHandlers = {
  mqtt_publish: mqttPublish,
  mqtt_read:    mqttRead,
  os_command:   osCommand,
  web_search:   webSearch,
}

// ── Factory ────────────────────────────────────────────────────────────────────
// Usage: const executeTool = createExecuteTool(ctx)
// ctx is built once in App.jsx and passed here — no re-creation unless deps change

export function createExecuteTool(ctx) {
  return async function executeTool(name, args) {
    const skill = (ctx.settings.skills || []).find(sk => sk.name === name)
    if (skill && !skill.enabled) return { success: false, error: `Tool "${name}" is disabled` }
    const handler = toolHandlers[name]
    if (!handler) return { success: false, error: `Unknown tool: ${name}` }
    return handler(args, ctx)
  }
}
