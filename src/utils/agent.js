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

  async function chat(messages, options = {}, signal) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, ...options }),
      signal
    })
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`)
    return res.json()
  }

  async function stream(messages, options = {}, onChunk, signal) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, stream: true, ...options }),
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

// ── Result Summarizer ─────────────────────────────────────────────────────────

function summarizeResults(allToolResults, deviceList) {
  return allToolResults.map(r => {
    const ok = r.result?.error === undefined
    const icon = ok ? '✅' : '❌'
    const device = deviceList?.find(d => d.pubTopic === r.args?.topic || d.subTopic === r.args?.topic)
    const label = device ? `${device.name} (${device.room})` : r.args?.topic || r.args?.query || ''

    switch (r.name) {
      case 'mqtt_publish':
        return ok
          ? `${icon} mqtt_publish → ${label} = ${r.args.payload}`
          : `${icon} mqtt_publish → ${label} failed: ${r.result.error}`
      case 'mqtt_read':
        return ok
          ? `${icon} mqtt_read → ${label} = ${r.result.value}`
          : `${icon} mqtt_read → ${label} failed: ${r.result.error}`
      case 'web_search':
        return ok
          ? `${icon} web_search [query: "${r.args?.query}"] → ${r.result.summary ?? 'got results'}`
          : `${icon} web_search failed: ${r.result.error}`
      case 'os_command':
        return ok
          ? `${icon} os_command → ${r.result.summary ?? 'executed'}`
          : `${icon} os_command failed: ${r.result.error}`
      default:
        return `${icon} ${r.name}: ${ok ? 'success' : r.result.error}`
    }
  }).join('\n\n---\n\n')
}

function summarizeDevices(deviceList) {
  return (deviceList || [])
    .map(d => {
      const sub = d.subTopic ? ` | subTopic: ${d.subTopic}` : ''
      if (d.type === 'analog')
        return `${d.name} (${d.room}) — analog | state: ${d.value}/${d.max ?? 255} | pubTopic: ${d.pubTopic}${sub}`
      if (d.type === 'os_terminal')
        return `${d.name} (${d.room}) — os_terminal (${d.os ?? 'unknown OS'}) | pubTopic: ${d.pubTopic}${sub}`
      return `${d.name} (${d.room}) — digital | state: ${d.on ? 'ON' : 'OFF'} | pubTopic: ${d.pubTopic}${sub}`
    })
    .join('\n') || 'No devices registered'
}

// ── Responder Tool Context Formatter ─────────────────────────────────────────

function formatResultsForResponder(allToolResults, deviceList) {
  return allToolResults.map(t => {
    const ok = t.result?.error === undefined
    if (!ok) return `[${t.name}] Error: ${t.result.error}`

    const device = deviceList?.find(d => d.pubTopic === t.args?.topic || d.subTopic === t.args?.topic)
    const label = device ? `${device.name} (${device.room})` : t.args?.topic

    switch (t.name) {
      case 'mqtt_publish':
        return `[${t.name}] Set ${label} = ${t.args?.payload}`
      case 'mqtt_read':
        return `[${t.name}] ${label} = ${t.result.value ?? 'no data'}`
      case 'web_search':
        return `[${t.name}] Query: ${t.args?.query}\n${t.result.summary}`
      case 'os_command':
        return t.result.summary
          ? `[${t.name}]\n${t.result.summary}`
          : `[${t.name}] Command executed (no output)`
      default:
        return t.result.summary
          ? `[${t.name}] ${t.result.summary}`
          : `[${t.name}] success`
    }
  }).join('\n\n')
}

// ── Planner Guard ──────────────────────────────────────────────────────────────

function shouldRunPlanner(toolResults) {
  return toolResults.some(r => {
    if (r.result?.error !== undefined) return true
    if (r.result?.value !== undefined) return true
    if (r.result?.summary !== undefined) return true
    return false
  })
}

// ── Time Helper ───────────────────────────────────────────────────────────────

function nowString() {
  return new Date().toLocaleString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })
}

// ── Agent Nodes ────────────────────────────────────────────────────────────────

async function routerNode(state) {
  const { text, settings, deviceList, apiHistory = [], signal } = state
  const llm = createLLMClient(settings)
  const tools = buildTools(settings)

  const systemPrompt = `You are a smart home tool dispatcher. Output tool calls only — no text, no explanation.
Current date & time: ${nowString()}

Return EMPTY (no tool calls) when the message is pure conversation: greetings, farewells, thanks, acknowledgements, questions about you as an AI, or opinions unrelated to any device.

mqtt_read — call to check the current state of a device. Use the pubTopic or subTopic from the device list.
  Returns the live value directly from the widget (no MQTT round-trip needed).

mqtt_publish — call when the user intends to change a device state. Infer intent from context even without exact keywords.
  - Direct intents: "turn on the lamp", "ปิดไฟ", "dim to 50%"
  - Indirect intents: "it's too dark" (implies turn on light), "I'm freezing" (implies turn on heater/turn off AC)
  Rule: use the EXACT pubTopic from the device list. Digital payload = "true"/"false". Analog payload = number string 0–max.

os_command — call when the user wants to run a command on a remote machine AND an os_terminal device exists.
  Use the OS shown in the device list (e.g. "os_terminal (windows)") as the "os" argument — do NOT guess.
  wait_output: true for commands that return output (ls, dir, cat). false for fire-and-forget (shutdown, open app).
  IMPORTANT: If the command requires opening a URL that is not yet known (e.g. a song, video, website),
  call web_search FIRST to find the real URL. Do NOT call os_command in the same round — the planner will follow up with the actual URL.

web_search — call when the user explicitly needs current external information that cannot be answered from context.
  e.g. "search for...", "what's the weather?", "latest news about..."
  Do NOT call if the answer is already known or the question is conversational.

Available devices:
${summarizeDevices(deviceList)}`

  let data
  try {
    data = await llm.chat(
      [{ role: 'system', content: systemPrompt }, ...apiHistory, { role: 'user', content: text }],
      { ...(tools.length ? { tools, tool_choice: 'auto' } : {}), temperature: 0.1, frequency_penalty: 0.3, max_tokens: 4096 },
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
  const { toolCalls, executeTool, onToolCall, onToolResult, settings, apiHistory = [], signal } = state
  const round = (state.toolRound || 0) + 1   // 1-indexed label for UI

  const toolResults = await Promise.all(
    toolCalls.map(async tc => {
      const name = tc.function.name
      let args = {}
      try { args = JSON.parse(tc.function.arguments || '{}') } catch { args = tc.function.arguments }

      if (name === 'web_search' && args.query) {
        args.query = await generateSearchQuery({ settings, query: args.query, apiHistory, signal })
      }

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

  const systemPrompt = `You are a completion checker. Output tool calls only — no text.

User request: "${text}"

Executed so far:
${summarizeResults(allToolResults, deviceList)}

Available devices:
${summarizeDevices(deviceList)}

Check: does every target in the user's intent have a successful result above?
- All targets done → return empty (no tool calls).
- A target is missing → call the tool for that specific target only.
- A call failed → retry once with corrected arguments if fixable.

Tool chaining rule:
- If the results above contain a URL from web_search, and the user's goal is to open or play something, you MUST call "os_command" to execute it immediately.
- Example instruction: "open this URL in the browser: https://www.youtube.com/watch?v=xxxxx"
- Do NOT write a vague instruction. Always include the actual URL in the command.`

  let data
  try {
    data = await llm.chat(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }],
      { ...(tools.length ? { tools, tool_choice: 'auto' } : {}), temperature: 0.1, frequency_penalty: 0.3, max_tokens: 1024 },
      signal
    )
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error(`Planner: ${err.message}`)
  }

  const rawToolCalls = data?.choices?.[0]?.message?.tool_calls || []

  // ✨ Argument-Level Masking (ป้องกันลูปแบบ 100% สำหรับทุก Tools)
  const successfulCalls = allToolResults.filter(r => !r.result?.error)

  const filteredToolCalls = rawToolCalls.filter(newCall => {
    let newArgs = {}
    try { newArgs = JSON.parse(newCall.function.arguments || '{}') } catch { }

    const isDuplicate = successfulCalls.some(pastCall => {
      if (pastCall.name !== newCall.function.name) return false

      const pastKeys = Object.keys(pastCall.args || {})
      const newKeys = Object.keys(newArgs)

      if (pastKeys.length !== newKeys.length) return false
      return pastKeys.every(k => String(pastCall.args[k]) === String(newArgs[k]))
    })

    return !isDuplicate
  })

  return { ...state, toolCalls: filteredToolCalls }
}

async function responderNode(state) {
  const { text, settings, apiHistory, allToolResults = [], deviceList, onStream, signal } = state
  const llm = createLLMClient(settings)

  const toolContext = allToolResults.length
    ? formatResultsForResponder(allToolResults, deviceList)
    : 'None — no tools were called'

  const stateSummary = allToolResults.length === 0
    ? (deviceList || [])
      .map(d => `- [${d.room}] ${d.name} (${d.type}): ${d.type === 'digital' ? (d.on ? 'ON' : 'OFF') : d.value}`)
      .join('\n') || 'No devices registered'
    : null

  const systemPrompt = `${settings.systemPrompt}
(Current date & time: ${nowString()} — use this when relevant, do not announce it unprompted.)

[User Info]
Name: "${settings.profile?.name || 'User'}"${stateSummary ? `

[Current Home Status]
${stateSummary}` : ''}

[Tool Results]
${toolContext}`

  let reply = ''

  await llm.stream(
    [{ role: 'system', content: systemPrompt }, ...apiHistory, { role: 'user', content: text }],
    { temperature: 0.6, frequency_penalty: 0.3, max_tokens: 4096 },
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

// ── Sub-agents ────────────────────────────────────────────────────────────────

const OS_COMMAND_SYSTEM = `You are a terminal command translator for remote machine control.
Given a natural-language instruction and a target OS, output the exact terminal command to execute.

Output rules:
- Return ONLY the raw command string — no explanation, no markdown, no code fences, no quotes
- Single command per response (pipelines allowed only when necessary)
- NEVER invent placeholder values — use only real values from the instruction
- If asked to open a video/song but no URL is in the instruction → use a YouTube search URL instead:
  windows: start https://www.youtube.com/results?search_query=song+name
  mac:     open  https://www.youtube.com/results?search_query=song+name
  linux:   xdg-open https://www.youtube.com/results?search_query=song+name

Command syntax by OS:
- windows → Command Prompt (cmd.exe); use PowerShell only if explicitly requested
- mac     → bash / zsh
- linux   → POSIX sh / bash

Safety:
- If the instruction would destroy system files, format drives, or wipe data → respond with exactly: UNSAFE`

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

const SEARCH_QUERY_SYSTEM = `You are a Search Context Optimizer.
Your task is to analyze the conversation history and the user's intended search query to generate the most precise Google search keyword.

Rules:
- Output ONLY the raw search query string. No explanation, no quotes.
- Resolve pronouns (e.g., "หาข้อมูลเรื่องนั้นต่อ", "ขอเพลงที่คุยกันเมื่อกี้") by looking at the history.
- Extract only the essential keywords needed for a good search engine result. 
- MUST remove conversational filler words like "หาเพลง", "เปิด", "search for", "ขอวิดีโอ" and output ONLY the core entity/topic.
- If the original query is already perfect and clear, output it exactly as is.`

export async function generateSearchQuery({ settings, query, apiHistory, signal }) {
  const llm = createLLMClient(settings)
  const recentHistory = (apiHistory || []).slice(-4)

  try {
    const data = await llm.chat(
      [
        { role: 'system', content: SEARCH_QUERY_SYSTEM },
        ...recentHistory,
        { role: 'user', content: `Router intended query: "${query}"\nPlease output the optimized search query:` },
      ],
      { temperature: 0.1, max_tokens: 128 },
      signal
    )
    const optimized = data?.choices?.[0]?.message?.content?.trim()
    return optimized || query
  } catch (err) {
    console.warn('[Agent] Search query optimization failed, falling back to original:', err)
    return query
  }
}