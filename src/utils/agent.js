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

// ── 2. Nodes ─────────────────────────────────────────────────────────────────

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

  // ✨ เอากลับมาแล้วมึง! ใช้ systemPrompt จาก Settings เป็นฐาน 
  // แล้วค่อยตบด้วย Context ของบ้าน เพื่อความเป๊ะ
  const systemPrompt = `${settings.systemPrompt}

[Real-time Context]
Current time: ${nowString()}
User: ${settings.profile?.name || 'User'}
Assistant Name: ${settings.profile?.assistantName || 'Assistant'}

[Available Devices]
${summarizeDevices(deviceList)}

[System Directives]
- Always prioritize using tools to interact with the home.
- If a tool fails, explain why based on the result.
- Do not confirm an action unless the tool result confirms success.`;

  const fullMessages = [new SystemMessage(systemPrompt), ...messages];

  let finalMessage;
  const stream = await agent.stream(fullMessages, { signal });

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

    toolMessages.push(new ToolMessage({
      content: typeof result === "object" ? JSON.stringify(result) : String(result),
      name: tc.name,
      tool_call_id: tc.id
    }));
  }

  return { messages: toolMessages, toolRound: currentRound };
}

// ── 3. Graph Logic ───────────────────────────────────────────────────────────

function shouldContinue(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    if (state.toolRound >= 5) return END; // กันลูปนรก
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

// ── 4. Exported Functions ────────────────────────────────────────────────────

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

export async function generateOsCommand({ settings, instruction, os, signal }) {
  const llm = new ChatOpenAI({
    apiKey: settings.apiKey,
    configuration: { apiKey: settings.apiKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0,
  });

  const messages = [
    new SystemMessage(`You are a terminal command translator. Output ONLY the raw command. OS: ${os}`),
    new HumanMessage(instruction)
  ];

  const response = await llm.invoke(messages, { signal });
  return response.content.trim();
}

export async function generateSearchQuery({ settings, query, apiHistory, signal }) {
  const llm = new ChatOpenAI({
    apiKey: settings.apiKey,
    configuration: { apiKey: settings.apiKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0.1,
  });

  const recentHistory = (apiHistory || []).slice(-4).map(m =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  );

  const messages = [
    new SystemMessage(`Output ONLY the optimized search query string.`),
    ...recentHistory,
    new HumanMessage(`Query: ${query}`)
  ];

  const response = await llm.invoke(messages, { signal });
  return response.content.trim();
}