// ── remote_shell skill ────────────────────────────────────────────────────────
// Two backends, selected by settings.remoteShellBackend:
//
//   'browser' (default)
//     Legacy path — mirrors os_command: generates command via a sub-LLM call,
//     then publishes over MQTT. Device must have type 'os_terminal' with pubTopic.
//
//   'mcp' (beta)
//     Calls the SynaptaOS MCP server (POST /run). CrewAI handles safety check
//     and command generation server-side; execution goes over WebSocket directly
//     to the terminal agent — no MQTT broker involved.
//     Device must have type 'ws_terminal' with agentName matching the terminal agent.
//
// Fallback: if MCP mode fails (server unreachable, etc.) the call transparently
// retries in browser mode and logs a warning — the agent never sees the failure.
//
// To remove this feature entirely:
//   1. Delete this file
//   2. Remove `remote_shell: remoteShell` from agentSkills.js toolHandlers
//   3. Remove the remote_shell skill entry + remoteShellBackend/mcpServerUrl from data.js

import { generateOsCommand } from './agent.js'

// ── Browser mode ─────────────────────────────────────────────────────────────

async function remoteShellBrowser(args, ctx) {
  const { mqttClient, settings, devicesRef, baseTopicRef,
    mqttWaitForStream, normalizeBase, buildFullTopic } = ctx
  const { task, agent_name, wait_output } = args

  if (!mqttClient) return { success: false, error: 'MQTT not connected' }

  const device = devicesRef.current.find(
    d => d.agentName === agent_name || d.name === agent_name
  )
  if (!device)       return { success: false, error: `Device '${agent_name}' not found` }
  if (!device.pubTopic) return { success: false, error: `Device '${agent_name}' has no pubTopic` }

  let command
  try {
    command = await generateOsCommand({ settings, instruction: task, os: device.os || 'linux' })
  } catch (err) {
    return { success: false, error: err.message }
  }

  const base        = normalizeBase(baseTopicRef.current)
  const fullTopic   = buildFullTopic(device.pubTopic, base)
  const outputTopic = wait_output && device.subTopic
    ? buildFullTopic(device.subTopic, base)
    : null
  const streamPromise = outputTopic ? mqttWaitForStream(outputTopic, 10000) : null

  try {
    await new Promise((resolve, reject) =>
      mqttClient.publish(fullTopic, command, { qos: 2 }, err => err ? reject(err) : resolve())
    )
  } catch (err) {
    return { success: false, error: err.message }
  }

  if (!streamPromise) return { success: true, summary: `Command sent: ${command}` }

  const { chunks, timedOut } = await streamPromise
  const output = chunks.join('\n')

  if (timedOut && chunks.length === 0)
    return { success: true, summary: `Command sent: ${command}\n\n⚠️ ไม่ได้รับผลลัพธ์ — terminal agent อาจออฟไลน์อยู่` }

  const note = timedOut ? '\n\n⚠️ ไม่ได้รับ (mcp_end) — agent อาจขาดการเชื่อมต่อ' : ''
  return { success: true, summary: `Ran: ${command}\n\n${output || '(no output)'}${note}` }
}

// ── MCP mode ─────────────────────────────────────────────────────────────────

async function remoteShellMcp(args, ctx) {
  const { task, agent_name, wait_output } = args
  const url = (ctx.settings.mcpServerUrl || 'http://localhost:8000').replace(/\/$/, '')

  const res = await fetch(`${url}/run`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ task, agent_name, wait_output }),
  })

  if (!res.ok) throw new Error(`MCP server HTTP ${res.status}`)

  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'Unknown server error')
  return { success: true, summary: data.summary }
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function remoteShell(args, ctx) {
  const backend = ctx.settings.remoteShellBackend || 'browser'

  if (backend === 'mcp') {
    try {
      return await remoteShellMcp(args, ctx)
    } catch (err) {
      console.warn('[remote_shell] MCP mode failed, falling back to browser mode:', err.message)
      return remoteShellBrowser(args, ctx)
    }
  }

  return remoteShellBrowser(args, ctx)
}
