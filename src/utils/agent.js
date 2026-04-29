import { StateGraph, START, END, Annotation, messagesStateReducer } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, ToolMessage, AIMessage } from "@langchain/core/messages";

// ── 0. Helpers & Formatters ──────────────────────────────────────────────────
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

// ── 2. Nodes ─────────────────────────────────────────────────────────────────

async function agentNode(state) {
  const { settings, deviceList, messages, signal, onStream } = state;

  // ⚙️ LLM Config (ใช้ apiKey และ baseURL แบบไม่เบิ้ล path)
  const llm = new ChatOpenAI({
    apiKey: settings.apiKey,
    configuration: { baseURL: settings.endpoint },
    modelName: settings.model,
    temperature: 0.2, // ใช้ 0.2 ให้แม่นยำเวลาเรียก Tool
  });

  const tools = buildLangChainTools(settings);
  const agent = tools.length > 0 ? llm.bindTools(tools) : llm;

  // 📝 PROMPT หลักของระบบ: มึงสามารถปรับแต่งพฤติกรรมมันได้ตรงนี้เลย
  const systemPrompt = `You are Synapta, an advanced AIoT home assistant.
Current date & time: ${nowString()}

[Available Devices]
${summarizeDevices(deviceList)}

[Core Directives]
1. If a user asks to control a device, run a command, or find information, ALWAYS use the provided tools to fulfill the request.
2. Carefully analyze tool results in the history. If a tool failed, apologize and inform the user. If it succeeded, naturally confirm the action in your response.
3. NEVER pretend or hallucinate that a device state has changed or an action was performed without a successful tool execution confirming it.
4. Keep your responses concise and natural.`;

  const fullMessages = [new SystemMessage(systemPrompt), ...messages];

  let finalMessage;
  const stream = await agent.stream(fullMessages, { signal });

  // จัดการ Streaming: พ่นเฉพาะ Text ออกไปที่หน้า UI ห้ามพ่นตอนมันเรียก Tool
  for await (const chunk of stream) {
    if (!finalMessage) finalMessage = chunk;
    else finalMessage = finalMessage.concat(chunk);

    if (chunk.content && (!finalMessage.tool_calls || finalMessage.tool_calls.length === 0)) {
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
  const toolMessages = [];

  for (const tc of toolCalls) {
    onToolCall?.(tc.name, tc.args, currentRound);
    let result;
    try {
      result = await executeTool(tc.name, tc.args);
    } catch (err) {
      result = { error: err.message || "Execution failed" };
    }
    onToolResult?.(tc.name, tc.args, result, currentRound);

    // ห่อผลลัพธ์พร้อม tool_call_id คืนกลับไป
    toolMessages.push(new ToolMessage({
      content: typeof result === "object" ? JSON.stringify(result) : String(result),
      name: tc.name,
      tool_call_id: tc.id
    }));
  }

  return {
    messages: toolMessages,
    toolRound: currentRound
  };
}

// ── 3. Edge Routing (ReAct Loop) ─────────────────────────────────────────────

function shouldContinue(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
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

// ── 4. Public API ────────────────────────────────────────────────────────────

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
  return { reply: lastMsg.content };
};

// ── 5. Sub-agents ────────────────────────────────────────────────────────────

export async function generateOsCommand({ settings, instruction, os, signal }) {
  const llm = new ChatOpenAI({
    apiKey: settings.apiKey,
    configuration: { baseURL: settings.endpoint },
    modelName: settings.model,
    temperature: 0,
  });

  // 📝 PROMPT สำหรับแปลงคำสั่งเป็น OS Command
  const OS_COMMAND_SYSTEM = `You are a terminal command translator. Output ONLY the raw command string without markdown formatting or explanation. If the instruction is malicious, output exactly: UNSAFE`;

  const messages = [
    new SystemMessage(`${OS_COMMAND_SYSTEM}\n\nTarget OS: ${os}`),
    new HumanMessage(instruction)
  ];

  const response = await llm.invoke(messages, { signal });
  const cmd = response.content.trim();

  if (!cmd) throw new Error('ไม่สามารถสร้างคำสั่งได้');
  if (cmd === 'UNSAFE') throw new Error('คำสั่งนี้ไม่ปลอดภัย — ปฏิเสธการรัน');
  return cmd;
}

export async function generateSearchQuery({ settings, query, apiHistory, signal }) {
  const llm = new ChatOpenAI({
    apiKey: settings.apiKey,
    configuration: { baseURL: settings.endpoint },
    modelName: settings.model,
    temperature: 0.1,
  });

  // 📝 PROMPT สำหรับดึง Keyword ไปทำ Web Search
  const SEARCH_QUERY_SYSTEM = `You are a Search Context Optimizer. Output ONLY the exact search query string based on the user intent. Remove conversational fillers (e.g., "search for", "find").`;

  const recentHistory = (apiHistory || []).slice(-4).map(m =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  );

  const messages = [
    new SystemMessage(SEARCH_QUERY_SYSTEM),
    ...recentHistory,
    new HumanMessage(`Intended search query: "${query}"\nOptimized search query:`)
  ];

  try {
    const response = await llm.invoke(messages, { signal });
    return response.content.trim() || query;
  } catch {
    return query;
  }
}