// ── LLM Client ────────────────────────────────────────────────────────────────
// Wraps fetch calls to any OpenAI-compatible endpoint.
// Swap endpoint/model by passing different settings — no other code changes needed.

function createLLMClient({ endpoint, apiKey, model }) {
  const url = `${endpoint}/chat/completions`
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...(endpoint.includes('openrouter.ai') && {
      'HTTP-Referer': window.location.origin,
      'X-Title': 'AIoT Assistant',
    }),
  }
  const mdl = model

  async function chat(messages, options = {}, signal) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: mdl, messages, ...options }),
      signal
    })
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`)
    return res.json()
  }

  async function stream(messages, options = {}, onChunk, signal) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: mdl, messages, stream: true, ...options }),
      signal
    })
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) onChunk(delta)
        } catch { }
      }
    }
  }

  return { chat, stream }
}

// ── Mini Graph Engine ──────────────────────────────────────────────────────────
// LangGraph-inspired: nodes are async functions (state) => state.
// Edges are functions (state) => nextNodeName | null (null = END).

function createGraph({ nodes, edges, entry }) {
  return {
    async run(initialState) {
      let state = initialState
      let current = entry
      while (current) {
        const node = nodes[current]
        if (!node) throw new Error(`Agent graph: node "${current}" not found`)
        state = await node(state)
        current = edges[current]?.(state) ?? null
      }
      return state
    },
  }
}

// ── Tools Helper ───────────────────────────────────────────────────────────────

function buildTools(settings) {
  return (settings.skills || [])
    .filter(sk => sk.enabled)
    .map(sk => {
      let parameters = { type: 'object', properties: {} }
      try { const p = JSON.parse(sk.schema); if (p?.type === 'object') parameters = p } catch { }
      return { type: 'function', function: { name: sk.name, description: sk.description, parameters } }
    })
}

// ── Planner Guard ──────────────────────────────────────────────────────────────
// Returns true only if tool results contain data worth reasoning about.
// Pure fire-and-forget tools (mqtt_publish success) skip the planner entirely.

function shouldRunPlanner(toolResults) {
  return toolResults.some(r => {
    if (r.result?.error !== undefined) return true  // any failure → planner may recover
    if (r.result?.value !== undefined) return true  // mqtt_read returned sensor data
    if (r.result?.organic !== undefined) return true  // web_search returned results
    if (r.result?.output !== undefined) return true  // os_command returned output
    return false
    // mqtt_publish success: { success, topic, payload } — nothing to reason about
  })
}

// ── Agent Nodes ────────────────────────────────────────────────────────────────

async function routerNode(state) {
  const { text, settings, deviceList, apiHistory = [], signal } = state
  const llm = createLLMClient(settings)
  const tools = buildTools(settings)

  const systemPrompt = `You are a smart home tool dispatcher. Output tool calls only — no text, no explanation.

Return EMPTY (no tool calls) when the message is pure conversation: greetings, farewells, thanks, acknowledgements, questions about you as an AI, or opinions unrelated to any device.

mqtt_publish — call when the user wants to change a device state, directly or indirectly.
  Direct: "turn on the lamp", "ปิดไฟ", "dim to 50%"
  Indirect: "it's too dark" → turn on light | "I'm cold" → turn on heater | "it's hot" → turn on AC/fan
  Rule: use the EXACT pubTopic from the device list. Digital payload = "true"/"false". Analog payload = number string 0–max.

mqtt_read — call only when the user is asking for the current value of a sensor or device.
  e.g. "what's the temperature?", "is the lamp on?", "ค่าเซ็นเซอร์เป็นเท่าไหร่"
  Do NOT call if the user is not asking for a live reading.

os_command — call when the user wants to run a command on a remote machine AND an os_terminal device exists.
  wait_output: true for commands that return output (ls, dir, cat). false for fire-and-forget (shutdown, open app).

web_search — call when the user explicitly needs current external information that cannot be answered from context.
  e.g. "search for...", "what's the weather?", "latest news about..."
  Do NOT call if the answer is already known or the question is conversational.

Available devices:
${JSON.stringify(deviceList, null, 2)}`

  let data
  try {
    data = await llm.chat(
      [{ role: 'system', content: systemPrompt }, ...apiHistory, { role: 'user', content: text }],
      { ...(tools.length ? { tools, tool_choice: 'auto' } : {}), temperature: 0.1, max_tokens: 4096 },
      signal
    )
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error(`Router: ${err.message}`)
  }

  const msg = data?.choices?.[0]?.message
  if (!msg) throw new Error('Router returned no response from API')

  return { ...state, toolCalls: msg.tool_calls || [] }
}

async function toolExecutorNode(state) {
  const { toolCalls, executeTool, onToolCall, onToolResult } = state
  const round = (state.toolRound || 0) + 1   // 1-indexed label for UI

  // Run all tool calls in parallel — independent tools don't need to wait for each other
  const toolResults = await Promise.all(
    toolCalls.map(async tc => {
      const name = tc.function.name
      let args = {}
      try { args = JSON.parse(tc.function.arguments || '{}') } catch { args = tc.function.arguments }

      onToolCall?.(name, args, round)

      let result
      try {
        result = await executeTool(name, args)
      } catch (err) {
        console.error(`[Agent] Tool execution failed for ${name}:`, err)
        result = { error: err.message || 'Execution failed' }
      }

      onToolResult?.(name, args, result, round)
      return { name, args, result }
    })
  )

  return {
    ...state,
    toolResults,
    allToolResults: [...(state.allToolResults || []), ...toolResults],
    toolRound: (state.toolRound || 0) + 1,
  }
}

async function plannerNode(state) {
  const { text, settings, deviceList, allToolResults, toolRound, apiHistory = [], signal } = state
  const llm = createLLMClient(settings)

  const tools = buildTools(settings)

  const executedHistory = allToolResults.map(r => ({
    tool: r.name,
    args: r.args,
    result: r.result,
  }))

  const systemPrompt = `You are a completion checker. Output tool calls only — no text.

User request: "${text}"
Executed so far: ${JSON.stringify(executedHistory, null, 2)}
Available devices: ${JSON.stringify(deviceList, null, 2)}

Check: does every target in the request have a successful result above?
- All targets done → return empty (no tool calls).
- A target is missing → call the tool for that specific target only.
- A call failed → retry once with corrected arguments if fixable.
- Never repeat a call that already succeeded. Never add calls unrelated to the original request.`

  let data
  try {
    data = await llm.chat(
      [{ role: 'system', content: systemPrompt }, ...apiHistory, { role: 'user', content: text }],
      { ...(tools.length ? { tools, tool_choice: 'auto' } : {}), temperature: 0.1, max_tokens: 1024 },
      signal
    )
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error(`Planner: ${err.message}`)
  }

  const msg = data?.choices?.[0]?.message
  return { ...state, toolCalls: msg?.tool_calls || [] }
}

async function responderNode(state) {
  const { text, settings, apiHistory, allToolResults = [], deviceList, onStream, signal } = state
  const llm = createLLMClient(settings)

  const toolContext = allToolResults.length
    ? allToolResults.map(t => `Tool ${t.name}: ${JSON.stringify(t.result)}`).join('\n')
    : 'None — no tools were called'

  const stateSummary = allToolResults.length
    ? (deviceList || [])
      .map(d => `- [${d.room}] ${d.name} (${d.type}): ${d.type === 'digital' ? (d.on ? 'ON' : 'OFF') : d.value}`)
      .join('\n') || 'No devices registered'
    : null

  const systemPrompt = `${settings.systemPrompt}

[User Info]
Name: "${settings.profile?.name || 'User'}"${stateSummary ? `

[Current Home Status]
${stateSummary}` : ''}

[Tool Execution Results]
${toolContext}`

  let reply = ''

  await llm.stream(
    [{ role: 'system', content: systemPrompt }, ...apiHistory, { role: 'user', content: text }],
    { temperature: 0.7, max_tokens: 4096 },
    chunk => { reply += chunk; onStream?.(chunk) },
    signal
  )

  return { ...state, reply }
}

// ── Agent Graph ────────────────────────────────────────────────────────────────

const agentGraph = createGraph({
  nodes: {
    router: routerNode,
    toolExecutor: toolExecutorNode,
    planner: plannerNode,
    responder: responderNode,
  },
  edges: {
    router: state => state.toolCalls.length > 0 ? 'toolExecutor' : 'responder',
    // Skip planner if no tool returned meaningful data to reason about
    toolExecutor: state => shouldRunPlanner(state.toolResults) ? 'planner' : 'responder',
    planner: state => (state.toolCalls.length > 0 && state.toolRound < 2) ? 'toolExecutor' : 'responder',
  },
  entry: 'router',
})

// ── Public API ─────────────────────────────────────────────────────────────────

export const runAgent = params => agentGraph.run({
  toolCalls: [],
  toolResults: [],
  allToolResults: [],
  toolRound: 0,
  ...params,
})

// ── OS Command Generator ───────────────────────────────────────────────────────

const OS_COMMAND_SYSTEM = `You are a terminal command translator for remote machine control via MQTT.
Convert the user's instruction into the exact terminal command for the target OS.

Output rules:
- Return ONLY the raw command string — no explanation, no markdown, no code fences, no quotes
- Single command per response (pipelines allowed only when necessary)

Safety:
- If the instruction would destroy system files, format drives, or wipe data → respond with exactly: UNSAFE

Command syntax by OS:
- windows → Command Prompt (cmd.exe); use PowerShell only if explicitly requested
- mac     → bash / zsh
- linux   → POSIX sh / bash`

export async function generateOsCommand({ settings, instruction, os, signal }) {
  const llm = createLLMClient(settings)
  let data
  try {
    data = await llm.chat(
      [
        { role: 'system', content: `${OS_COMMAND_SYSTEM}\n\nTarget OS: ${os}` },
        { role: 'user', content: instruction },
      ],
      { temperature: 0, max_tokens: 256 },
      signal
    )
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error('OS command agent ไม่ตอบสนอง')
  }
  const cmd = data?.choices?.[0]?.message?.content?.trim() ?? ''
  if (!cmd) throw new Error('ไม่สามารถสร้างคำสั่งได้')
  if (cmd === 'UNSAFE') throw new Error('คำสั่งนี้ไม่ปลอดภัย — ปฏิเสธการรัน')
  return cmd
}