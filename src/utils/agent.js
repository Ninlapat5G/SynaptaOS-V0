import { StateGraph, START, END, Annotation, messagesStateReducer } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, ToolMessage, AIMessage, trimMessages } from "@langchain/core/messages";
import {
  buildContextMessage,
  buildOsCommandPrompt,
  SEARCH_QUERY_PROMPT,
  DETECT_NAME_PROMPT,
} from "./agent_prompt.js";

// ── 0. Helpers ────────────────────────────────────────────────────────────────
function nowString() {
  return new Date().toLocaleString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

function buildLangChainTools(settings) {
  return (settings.skills || [])
    .filter(sk => sk.enabled)
    .map(sk => ({
      type: "function",
      function: {
        name: sk.name,
        description: sk.description,
        parameters: JSON.parse(sk.schema || "{}")
      }
    }));
}

// ── 1. State Definition ──────────────────────────────────────────────────────
const AgentState = Annotation.Root({
  messages: Annotation({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  settings: Annotation(),
  deviceList: Annotation(),
  executeTool: Annotation(),
  onToolCall: Annotation(),
  onToolResult: Annotation(),
  onStream: Annotation(),
  signal: Annotation(),
  toolRound: Annotation({
    reducer: (curr, next) => next,
    default: () => 0
  })
});

// ── 2. Nodes (Main Agent) ────────────────────────────────────────────────────

async function agentNode(state) {
  const { settings, deviceList, messages, signal, onStream, toolRound } = state;

  // Build the set of enabled skill names so we can decide which device types
  // are visible to the agent. A device type is hidden when every skill that
  // can interact with it is disabled — the agent can't do anything with it anyway.
  //
  // Mapping: device.type → skill names that grant access
  //   digital / analog  → mqtt_publish OR mqtt_read (either one is enough to show)
  //   os_terminal       → os_command only
  //
  // Add new entries here whenever a new device type / skill pair is introduced.
  const enabledSkills = new Set(
    (settings.skills || []).filter(s => s.enabled).map(s => s.name)
  )
  const deviceTypeAccess = {
    digital:     ['mqtt_publish', 'mqtt_read'],
    analog:      ['mqtt_publish', 'mqtt_read'],
    os_terminal:  ['os_command'],
    hub:          ['hub'],
  }
  const visibleDevices = (deviceList || []).filter(d => {
    const required = deviceTypeAccess[d.type]
    // Unknown device types: always visible (future-proof)
    if (!required) return true
    return required.some(skill => enabledSkills.has(skill))
  })

  const llm = new ChatOpenAI({
    apiKey: settings.apiKey,
    configuration: {
      apiKey: settings.apiKey,
      baseURL: settings.endpoint,
      dangerouslyAllowBrowser: true
    },
    modelName: settings.model,
    temperature: toolRound === 0 ? 0.1 : 0.5,
  });

  const tools = buildLangChainTools(settings);
  const agent = tools.length > 0 ? llm.bindTools(tools) : llm;

  const personaMessage = new SystemMessage(
    settings.systemPrompt || "You are a helpful smart home assistant."
  );

  const contextMessage = new SystemMessage(
    buildContextMessage(nowString(), visibleDevices, settings.profile?.userBio || 'User')
  );

  const fullMessages = [personaMessage, contextMessage, ...messages];

  let finalMessage;
  const stream = await agent.stream(fullMessages, { signal });

  for await (const chunk of stream) {
    if (!finalMessage) finalMessage = chunk;
    else finalMessage = finalMessage.concat(chunk);

    if (chunk.content && !chunk.tool_call_chunks?.length) {
      onStream?.(chunk.content);
    }
  }

  return { messages: [finalMessage] };
}

async function toolNode(state) {
  const { messages, executeTool, onToolCall, onToolResult, toolRound } = state;
  const currentRound = toolRound + 1;

  const lastMessage = messages[messages.length - 1];
  const toolCalls = lastMessage.tool_calls || [];

  const promises = toolCalls.map(async (tc) => {
    onToolCall?.(tc.name, tc.args, currentRound);
    let result;
    try {
      result = await executeTool(tc.name, tc.args, state.signal);
    } catch (err) {
      result = { error: err.message || "Execution failed" };
    }
    onToolResult?.(tc.name, tc.args, result, currentRound);

    return new ToolMessage({
      content: typeof result === "object" ? JSON.stringify(result) : String(result),
      name: tc.name,
      tool_call_id: tc.id
    });
  });

  const toolMessages = await Promise.all(promises);

  return { messages: toolMessages, toolRound: currentRound };
}

// ── 3. Graph Logic (ReAct Loop) ──────────────────────────────────────────────

function shouldContinue(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    if (state.toolRound >= 3) {
      console.warn("[Agent] Reached max tool rounds. Forcing exit.");
      return END;
    }
    return "tools";
  }
  return END;
}

const workflow = new StateGraph(AgentState)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent");

const compiledGraph = workflow.compile();

export const runAgent = async (params) => {
  const rawMessages = (params.apiHistory || []).map(m =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  );
  rawMessages.push(new HumanMessage(params.text));

  // Budget: 128K context − ~3,750 overhead − 1.5× Thai underestimate factor → safe at 20K
  const previousMessages = await trimMessages(rawMessages, {
    maxTokens: 20000,
    tokenCounter: msgs => msgs.reduce((sum, m) => sum + Math.ceil(String(m.content).length / 3), 0),
    strategy: 'last',
    startOn: 'human',
    allowPartial: false,
  });

  const finalState = await compiledGraph.invoke({
    ...params,
    messages: previousMessages,
    toolRound: 0,
  });

  const lastMsg = finalState.messages[finalState.messages.length - 1];

  let finalReply = lastMsg.content;
  if (!finalReply && lastMsg.tool_calls?.length > 0) {
    finalReply = "ขออภัยค่ะ ระบบพยายามดำเนินการหลายครั้งแต่ไม่สำเร็จ ลองสั่งใหม่อีกครั้งนะคะ 🥺";
  }

  return { reply: finalReply };
};

// ── 4. Sub-Agents ────────────────────────────────────────────────────────────

export async function generateOsCommand({ settings, instruction, os, signal }) {
  const llm = new ChatOpenAI({
    apiKey: settings.apiKey,
    configuration: { apiKey: settings.apiKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0,
  });

  const messages = [
    new SystemMessage(buildOsCommandPrompt(os)),
    new HumanMessage(`Instruction: ${instruction}\nCommand:`)
  ];

  const response = await llm.invoke(messages, { signal });
  const cmd = response.content.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

  if (!cmd) throw new Error('ไม่สามารถสร้างคำสั่งได้');
  if (cmd === 'UNSAFE') throw new Error('คำสั่งนี้มีความเสี่ยงสูง — ระบบปฏิเสธการรัน');

  return cmd;
}

export async function generateSearchQuery({ settings, query, signal }) {
  const llm = new ChatOpenAI({
    apiKey: settings.apiKey,
    configuration: { apiKey: settings.apiKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0.1,
  }).withStructuredOutput({
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Optimized search query for web search engine' }
    },
    required: ['query']
  });

  const messages = [
    new SystemMessage(SEARCH_QUERY_PROMPT),
    new HumanMessage(`Raw query: "${query}"`)
  ];

  try {
    const response = await llm.invoke(messages, { signal });
    return response.query?.trim() || query;
  } catch {
    return query;
  }
}

export async function detectAssistantName({ settings, systemPrompt, signal }) {
  const llm = new ChatOpenAI({
    apiKey: settings.apiKey,
    configuration: { apiKey: settings.apiKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0,
  }).withStructuredOutput({
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The AI assistant name, or empty string if not found' }
    },
    required: ['name']
  });

  const messages = [
    new SystemMessage(DETECT_NAME_PROMPT),
    new HumanMessage(`System prompt:\n${systemPrompt}`)
  ];

  const response = await llm.invoke(messages, { signal });
  return response.name?.trim() || null;
}
