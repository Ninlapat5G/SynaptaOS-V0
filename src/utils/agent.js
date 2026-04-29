import { StateGraph, START, END, Annotation, messagesStateReducer } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, ToolMessage, AIMessage } from "@langchain/core/messages";

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
  const { settings, deviceList, messages, signal, onStream } = state;

  const llm = new ChatOpenAI({
    apiKey: settings.apiKey,
    configuration: {
      apiKey: settings.apiKey,
      baseURL: settings.endpoint,
      dangerouslyAllowBrowser: true
    },
    modelName: settings.model,
    temperature: 0.2,
  });

  const tools = buildLangChainTools(settings);
  const agent = tools.length > 0 ? llm.bindTools(tools) : llm;

  const personaMessage = new SystemMessage(
    settings.systemPrompt || "You are a helpful smart home assistant."
  );

  const contextMessage = new SystemMessage(`[SYSTEM ENVIRONMENT]
Time: ${nowString()} | User: ${settings.profile?.name || 'User'}

[DEVICES]
${summarizeDevices(deviceList)}

[STRICT DIRECTIVES]
1. USE TOOLS: Always use tools for actions or searching. Never assume device states.
2. CONTEXTUAL ARGS: When calling tools, provide fully resolved arguments.
3. RELY ON RESULTS: Read [Tool Results] before replying. If a tool fails, tell the user.`);

  const fullMessages = [personaMessage, contextMessage, ...messages];

  let finalMessage;
  const stream = await agent.stream(fullMessages, { signal });

  for await (const chunk of stream) {
    if (!finalMessage) finalMessage = chunk;
    else finalMessage = finalMessage.concat(chunk);

    // ✨ แก้หลอน 1: สตรีมเฉพาะ Text ที่ไม่ใช่ขยะจากการเตรียมเรียก Tool
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

  // ✨ รันแบบ PARALLEL ของแทร่! ใช้ Promise.all ให้มันยิง Tool พร้อมกันทีเดียว
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

  // รอให้ทุก Tool ทำงานเสร็จพร้อมกัน
  const toolMessages = await Promise.all(promises);

  return { messages: toolMessages, toolRound: currentRound };
}

// ── 3. Graph Logic (ReAct Loop) ──────────────────────────────────────────────

function shouldContinue(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    // ✨ ลดรอบลงมาเหลือ 3 พอ ถ้ามันยังโง่เรียก Tool เดิมๆ ก็ตัดจบเลย จะได้ไม่ค้าง
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
  const previousMessages = (params.apiHistory || []).map(m =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  );
  previousMessages.push(new HumanMessage(params.text));

  const finalState = await compiledGraph.invoke({
    ...params,
    messages: previousMessages,
    toolRound: 0,
  });

  const lastMsg = finalState.messages[finalState.messages.length - 1];

  // ✨ แก้หลอน 2: ดักจับกรณีมันโดนเตะออกจากลูป แล้วข้อความสุดท้ายเป็น Tool Call (เนื้อหาว่างเปล่า)
  let finalReply = lastMsg.content;
  if (!finalReply && lastMsg.tool_calls?.length > 0) {
    finalReply = "ขออภัยค่ะ ระบบพยายามดำเนินการหลายครั้งแต่ไม่สำเร็จ ลองสั่งใหม่อีกครั้งนะคะ 🥺";
  }

  return { reply: finalReply };
};

// ── 4. Sub-Agents ─────────────────────────

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