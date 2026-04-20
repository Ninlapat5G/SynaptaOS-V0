export async function callAgentRouter({ text, settings, deviceList }) {
  const skillTools = (settings.skills || [])
    .filter(s => s.enabled)
    .map(sk => {
      let params = { type: 'object', properties: {} }
      try {
        const p = JSON.parse(sk.schema)
        if (p?.type === 'object') params = p
      } catch {}
      return {
        type: 'function',
        function: { name: sk.name, description: sk.description, parameters: params },
      }
    })

  const agentSystemPrompt = `You are an invisible Autonomous IoT Routing Agent. Your ONLY job is to select tools to control or read devices based on the user's request.
CRITICAL RULES:
1. For mqtt_publish, you MUST use the EXACT 'pubTopic' string from the Available devices list below. Do NOT shorten or invent topics.
2. For payload:
   - If type is 'digital': payload MUST be exactly "true" (to turn on) or "false" (to turn off).
   - If type is 'analog': payload MUST be a number string between "0" and "255" (e.g. "128").
3. If no device manipulation is needed, respond with "NO_TOOL_NEEDED".
4. Do NOT output conversational text. Output ONLY tool calls or "NO_TOOL_NEEDED".

Available devices:
${JSON.stringify(deviceList, null, 2)}`

  const res = await fetch(`${settings.endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || 'typhoon-v2-70b-instruct',
      messages: [
        { role: 'system', content: agentSystemPrompt },
        { role: 'user', content: text },
      ],
      tools: skillTools.length > 0 ? skillTools : undefined,
      tool_choice: 'auto',
      temperature: 0.1,
    }),
  })

  if (!res.ok) throw new Error(`Agent Error ${res.status}`)
  return res.json()
}

export async function callFinalResponse({ text, apiHistory, settings, toolContext, deviceList }) {
  const stateSummary = deviceList
    ? deviceList
        .map(
          d =>
            `- [${d.room}] ${d.name} (${d.type}): ${
              d.type === 'digital' ? (d.on ? 'ON' : 'OFF') : d.value
            }`,
        )
        .join('\n')
    : 'Unknown'

  const finalSystemPrompt = `${settings.systemPrompt}

[User Info]
The person you are talking to is named "${settings.profile?.name || 'User'}" (Role: ${settings.profile?.role || 'Guest'}).

[Current Home Status]
${stateSummary}

[Tool Execution Result]
${toolContext || 'None. (You did not run any tools, or didn\'t need to)'}`

  const res = await fetch(`${settings.endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || 'typhoon-v2-70b-instruct',
      messages: [
        { role: 'system', content: finalSystemPrompt },
        ...apiHistory,
        { role: 'user', content: text },
      ],
      temperature: 0.7,
    }),
  })

  if (!res.ok) throw new Error(`API Error ${res.status}`)
  return res.json()
}
