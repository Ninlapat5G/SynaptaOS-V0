import { StateGraph, START, END, Annotation, messagesStateReducer } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, ToolMessage, AIMessage, trimMessages } from "@langchain/core/messages";

// ── 0. Helpers ────────────────────────────────────────────────────────────────
function nowString() {
  return new Date().toLocaleString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

function summarizeDevices(deviceList) {
  return (deviceList || [])
    .map(d => {
      const sub = d.subTopic ? ` | subTopic: ${d.subTopic}` : ''
      if (d.type === 'analog') return `${d.name} (${d.room}) — analog | state: ${d.value}/${d.max ?? 255} | pubTopic: ${d.pubTopic}${sub}`
      if (d.type === 'os_terminal') return `${d.name} (${d.room}) — os_terminal (${d.os ?? 'unknown OS'}) | pubTopic: ${d.pubTopic}${sub}`
      return `${d.name} (${d.room}) — digital | state: ${d.on ? 'ON' : 'OFF'} | pubTopic: ${d.pubTopic}${sub}`
    }).join('\n') || 'No devices registered';
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

  // ✨ กฎใหม่โคตรล้ำ: ทักท้วงก่อน ถ้ามึงดื้อก็จะยอมยิงให้
  const contextMessage = new SystemMessage(`[SYSTEM ENVIRONMENT]
  Time: ${nowString()} | User: ${settings.profile?.name || 'User'}

  [AVAILABLE DEVICES IN HOME]
  ${summarizeDevices(deviceList)}

  [IRONCLAD RULES]
  1. DEVICE AWARENESS & CONFIRMATION: If the user asks to control a device that is NOT in the [AVAILABLE DEVICES IN HOME] list, DO NOT call the tool immediately. 
    - You MUST politely inform them that the device is not registered.
    - Ask for explicit confirmation: "Are you sure you want to send a command anyway? If yes, please provide the exact MQTT topic."
    - ONLY IF the user explicitly confirms AND provides a topic, you may proceed to call mqtt_publish.
  2. NO HALLUCINATIONS: Never claim an action is done unless you see a SUCCESSFUL tool result.
  3. EXPLICIT ARGS: Resolve pronouns (it, this) to the exact device name.`);

  const fullMessages = [personaMessage, contextMessage, ...messages];

  let finalMessage;
  const stream = await agent.stream(fullMessages, { signal });

  for await (const chunk of stream) {
    if (!finalMessage) finalMessage = chunk;
    else finalMessage = finalMessage.concat(chunk);

    // ✨ สตรีมเฉพาะเนื้อหาที่คุยกับ User ตัดขยะ Tool Chunk ทิ้ง
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

  // ✨ รัน Tool แบบ Parallel โหลดพร้อมกันรัวๆ
  const promises = toolCalls.map(async (tc) => {
    onToolCall?.(tc.name, tc.args, currentRound);
    let result;
    try {
      result = await executeTool(tc.name, tc.args);
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
    // ✨ ลิมิตลูปไว้แค่ 3 รอบ กันมันคิดวนจนแอปค้าง
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

  const previousMessages = await trimMessages(rawMessages, {
    maxTokens: 4000,
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

  // ✨ ดักกรณีจบกราฟแล้วไม่มี Text มีแต่ Tool เพื่อให้ UI ไม่เอ๋อ
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

  const OS_COMMAND_SYSTEM = `You are a strict OS Command Translator.
Target OS: ${os}
Task: Convert the instruction into a valid, executable terminal command.
[RULES]
1. OUTPUT ONLY THE RAW COMMAND STRING.
2. NO markdown formatting, NO explanations.
3. If highly destructive/malicious, output EXACTLY: UNSAFE`;

  const messages = [
    new SystemMessage(OS_COMMAND_SYSTEM),
    new HumanMessage(`Instruction: ${instruction}`)
  ];

  const response = await llm.invoke(messages, { signal });
  const cmd = response.content.trim();

  if (!cmd) throw new Error('ไม่สามารถสร้างคำสั่งได้');
  if (cmd === 'UNSAFE') throw new Error('คำสั่งนี้มีความเสี่ยงสูง — ระบบปฏิเสธการรัน');

  return cmd.replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '').trim();
}

export async function generateSearchQuery({ settings, query, signal }) {
  const llm = new ChatOpenAI({
    apiKey: settings.apiKey,
    configuration: { apiKey: settings.apiKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0.1,
  });

  const SEARCH_QUERY_SYSTEM = `You are a Search Query Optimizer.
Task: Clean and optimize the provided text for a web search engine.
[RULES]
1. OUTPUT ONLY THE RAW SEARCH QUERY. No quotes, no explanations.
2. Remove conversational fillers.
3. Keep the most relevant keywords.`;

  const messages = [
    new SystemMessage(SEARCH_QUERY_SYSTEM),
    new HumanMessage(`Raw query: "${query}"\nOptimized query:`)
  ];

  try {
    const response = await llm.invoke(messages, { signal });
    let optimizedQuery = response.content.trim();
    if (optimizedQuery.startsWith('"') && optimizedQuery.endsWith('"')) {
      optimizedQuery = optimizedQuery.slice(1, -1);
    }
    return optimizedQuery || query;
  } catch (err) {
    return query;
  }
}