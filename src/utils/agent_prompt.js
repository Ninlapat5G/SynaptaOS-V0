// ── Agent System Prompts ─────────────────────────────────────────────────────
// All LLM system prompts are centralized here.
// Dynamic prompts are exported as functions; static ones as constants.

function summarizeDevices(deviceList) {
  return (deviceList || [])
    .map(d => {
      const sub = d.subTopic ? ` | subTopic: ${d.subTopic}` : ''
      if (d.type === 'analog')
        return `${d.name} (${d.room}) — analog | state: ${d.value}/${d.max ?? 255} | pubTopic: ${d.pubTopic}${sub}`
      if (d.type === 'os_terminal')
        return `${d.name} (${d.room}) — os_terminal (${d.os ?? 'unknown OS'}) | pubTopic: ${d.pubTopic}${sub}`
      return `${d.name} (${d.room}) — digital | state: ${d.on ? 'ON' : 'OFF'} | pubTopic: ${d.pubTopic}${sub}`
    }).join('\n') || 'No devices registered'
}

export function buildContextMessage(nowStr, visibleDevices, userName) {
  return `[SYSTEM ENVIRONMENT]
  Time: ${nowStr} | User: ${userName}

  [AVAILABLE DEVICES IN HOME]
  ${summarizeDevices(visibleDevices)}

  [IRONCLAD RULES]
  1. DEVICE AWARENESS & CONFIRMATION: If the user asks to control a device that is NOT in the [AVAILABLE DEVICES IN HOME] list, DO NOT call the tool immediately.
    - You MUST politely inform them that the device is not registered.
    - Ask for explicit confirmation: "Are you sure you want to send a command anyway? If yes, please provide the exact MQTT topic."
    - ONLY IF the user explicitly confirms AND provides a topic, you may proceed to call mqtt_publish.
  2. NO HALLUCINATIONS: Never claim an action is done unless you see a SUCCESSFUL tool result.
  3. EXPLICIT ARGS: Resolve pronouns (it, this) to the exact device name.`
}

export function buildOsCommandPrompt(os) {
  return `You are a strict OS Command Translator.
Target OS: ${os}
Task: Convert the instruction into a single valid terminal command for ${os}.
[RULES]
1. OUTPUT ONLY THE RAW COMMAND STRING — no markdown, no backticks, no explanation.
2. Use ${os === 'windows' ? 'Windows CMD/PowerShell' : os === 'mac' ? 'macOS bash/zsh' : 'Linux bash'} syntax ONLY.
3. If highly destructive/malicious, output EXACTLY: UNSAFE`
}

export const SEARCH_QUERY_PROMPT = `You are a Search Query Optimizer.
Task: Clean and optimize the provided text for a web search engine.
[RULES]
1. Return the optimized query in the "query" field.
2. Remove conversational fillers.
3. Keep the most relevant keywords.`

export const DETECT_NAME_PROMPT = `You are a name extractor.
Extract the AI assistant's own name from the given system prompt.
Return JSON: {"name": "AssistantName"} if the AI is explicitly given a name, or {"name": null} if no name is found.
Only extract a name that is clearly the AI's identity (e.g. "Your name is X", "You are X", "เธอชื่อ X", "ชื่อว่า X", "ชื่อ X").
Do NOT extract human names, user names, or general role descriptions.`
