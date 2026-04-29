// ── Skill Tool Handlers ────────────────────────────────────────────────────────
// Each handler: async (args, ctx) => result
// ctx = { mqttClient, settings, mqttWaitForMessage,
//          devicesRef, baseTopicRef, setDevices,
//          normalizeBase, buildFullTopic, generateOsCommand }
//
// To add a new skill:
//   1. Add a handler function below
//   2. Register it in toolHandlers map
//   3. Add its definition to DEFAULT_SETTINGS.skills in data.js

import { generateSearchQuery } from './agent.js'

const SERPER_URL = 'https://google.serper.dev/search'

async function mqttPublish(args, ctx) {
  const { mqttClient, devicesRef, baseTopicRef, setDevices, normalizeBase, buildFullTopic } = ctx

  if (!mqttClient) return { success: false, error: 'MQTT not connected' }

  const { topic, payload } = args
  const device = devicesRef.current.find(
    d => d.pubTopic === topic || d.pubTopic?.endsWith('/' + topic)
  )

  let finalTopic = topic;
  let isRaw = false;

  if (!device) {
    isRaw = true;
  } else {
    finalTopic = device.pubTopic;
  }

  const base = normalizeBase(baseTopicRef.current)
  const fullTopic = buildFullTopic(finalTopic, base)

  return new Promise(resolve => {
    mqttClient.publish(fullTopic, String(payload), { qos: 2 }, err => {
      if (err) { resolve({ success: false, error: err.message }); return }

      // อัปเดต UI เฉพาะของที่มีในลิสต์
      if (device) {
        setDevices(prev => prev.map(d => {
          if (d.id !== device.id) return d
          if (d.type === 'digital') return { ...d, on: payload === 'true' || payload === 'ON' || payload === '1' }
          if (d.type === 'analog') return { ...d, value: parseInt(payload, 10) || 0 }
          return d
        }))
      }

      resolve({
        success: true,
        topic: fullTopic,
        payload,
        message: isRaw ? 'Published to unlisted raw topic.' : 'Published.'
      })
    })
  })
}

async function mqttRead(args, ctx) {
  const { devicesRef } = ctx

  const topic = typeof args === 'string' ? args.trim() : args?.topic
  if (!topic) return { success: false, error: 'No topic specified' }

  const device = devicesRef.current.find(
    d => d.pubTopic === topic || d.subTopic === topic ||
      d.pubTopic?.endsWith('/' + topic) || d.subTopic?.endsWith('/' + topic)
  )

  if (!device) return { success: false, error: `No device found for topic: ${topic}` }

  const value = device.type === 'digital' ? (device.on ? 'ON' : 'OFF') : String(device.value)
  return { success: true, device: device.name, room: device.room, value }
}

async function osCommand(args, ctx) {
  const { mqttClient, settings, devicesRef, baseTopicRef,
    mqttWaitForMessage, normalizeBase, buildFullTopic, generateOsCommand } = ctx

  const { instruction, os, topic, wait_output } = args
  if (!mqttClient) return { success: false, error: 'MQTT not connected' }
  if (!instruction || !os || !topic) return { success: false, error: 'Missing args: instruction, os, topic' }

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

  const output = outputTopic ? await mqttWaitForMessage(outputTopic, 30000) : null

  if (output != null) return { success: true, summary: `Ran: ${command}\n\n${output}` }
  return { success: true, summary: `⚠️ No output received (timeout). Command was sent: ${command}` }
}

async function webSearch(args, ctx) {
  const { settings } = ctx
  const { query } = args

  if (!query) return { success: false, error: 'No search query provided' }

  const apiKey = settings.serperApiKey
  if (!apiKey) return { success: false, error: 'Serper API key ยังไม่ได้ตั้งค่า — ไปที่ Settings → Integrations' }

  let optimizedQuery = query
  try {
    optimizedQuery = await generateSearchQuery({ settings, query })
  } catch { /* ใช้ query เดิมถ้า optimize ไม่ได้ */ }

  let res
  try {
    res = await fetch(SERPER_URL, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: optimizedQuery, num: 3 }),
    })
  } catch (err) {
    return { success: false, error: `Network error: ${err.message}` }
  }

  if (res.status === 403) return { success: false, error: 'Serper API key ไม่ถูกต้อง หรือ quota หมดแล้ว — ตรวจสอบที่ serper.dev/dashboard' }
  if (res.status === 429) return { success: false, error: 'Serper API rate limit exceeded — ลองใหม่อีกสักครู่' }
  if (!res.ok) return { success: false, error: `Serper API error: HTTP ${res.status}` }

  const data = await res.json()

  const parts = []

  if (data.answerBox?.answer)
    parts.push(data.answerBox.answer)
  else if (data.answerBox?.snippet)
    parts.push(data.answerBox.snippet)

  if (data.knowledgeGraph?.description)
    parts.push(`${data.knowledgeGraph.title}: ${data.knowledgeGraph.description}`)

  const organic = (data.organic || []).slice(0, 3)
  if (organic.length)
    parts.push(organic.map(r => `${r.title}\n${r.snippet}\n${r.link}`).join('\n\n'))

  const summary = parts.join('\n\n') || 'No results found'
  return { success: true, query: optimizedQuery, summary }
}

// ── Registry ───────────────────────────────────────────────────────────────────

const toolHandlers = {
  mqtt_publish: mqttPublish,
  mqtt_read: mqttRead,
  os_command: osCommand,
  web_search: webSearch,
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createExecuteTool(ctx) {
  return async function executeTool(name, args) {
    const skill = (ctx.settings.skills || []).find(sk => sk.name === name)
    if (skill && !skill.enabled) return { success: false, error: `Tool "${name}" is disabled` }
    const handler = toolHandlers[name]
    if (!handler) return { success: false, error: `Unknown tool: ${name}` }
    return handler(args, ctx)
  }
}