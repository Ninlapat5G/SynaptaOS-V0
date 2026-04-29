import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";

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

// ── 1. State Definition ──────────────────────────────────────────────────
const AgentState = Annotation.Root({
  text: Annotation(),
  settings: Annotation(),
  deviceList: Annotation(),
  apiHistory: Annotation(),
  allToolResults: Annotation({
    reducer: (curr, next) => curr.concat(next),
    default: () => []
  }),
  toolCalls: Annotation(),
  reply: Annotation(),
  executeTool: Annotation(),
  onToolCall: Annotation(),
  onToolResult: Annotation(),
  onStream: Annotation(),
  signal: Annotation(),
  toolRound: Annotation({
    reducer: (curr, next) => next, // เก็บค่าล่าสุด
    default: () => 0
  })
});

// ── 2. Nodes ──────────────────────────────────────────────────────────────

async function routerNode(state) {
  const { settings, text, deviceList, apiHistory, signal, allToolResults } = state;

  const llm = new ChatOpenAI({
    openAIApiKey: settings.apiKey,
    configuration: { baseURL: `${settings.endpoint}/chat/completions` },
    modelName: settings.model,
    temperature: 0.1,
  });

  const tools = buildLangChainTools(settings);
  const boundLlm = tools.length > 0 ? llm.bindTools(tools) : llm;

  const systemPrompt = `You are Synapta smart home tool dispatcher. Output tool calls only.
Current date & time: ${nowString()}

Available devices:
${summarizeDevices(deviceList)}

Return EMPTY (no tool calls) when the message is pure conversation.`;

  const messages = [
    new SystemMessage(systemPrompt),
    ...apiHistory.map(m => m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)),
  ];

  // ถ้านี่คือการวนลูป (มีผลลัพธ์ tool ก่อนหน้า) ให้ใส่ผลลัพธ์เข้าไปให้มันพิจารณาด้วย
  if (allToolResults.length > 0) {
    const toolSummary = allToolResults.map(r => `[${r.name}] ${JSON.stringify(r.result)}`).join('\n');
    messages.push(new HumanMessage(`${text}\n\n[Previous Tool Results]:\n${toolSummary}\n\nDo we need to call any more tools to complete the user's request? If yes, call them. If no, just output text to finish.`));
  } else {
    messages.push(new HumanMessage(text));
  }

  const response = await boundLlm.invoke(messages, { signal });

  return {
    toolCalls: response.tool_calls || []
  };
}

async function toolExecutorNode(state) {
  const { toolCalls, executeTool, onToolCall, onToolResult, toolRound } = state;
  const currentRound = toolRound + 1;
  const results = [];

  for (const tc of toolCalls) {
    onToolCall?.(tc.name, tc.args, currentRound);
    let result;
    try {
      result = await executeTool(tc.name, tc.args);
    } catch (err) {
      result = { error: err.message || 'Execution failed' };
    }
    onToolResult?.(tc.name, tc.args, result, currentRound);
    results.push({ name: tc.name, args: tc.args, result });
  }

  return { allToolResults: results, toolCalls: [], toolRound: currentRound };
}

async function responderNode(state) {
  const { settings, text, allToolResults, apiHistory, onStream, signal, deviceList } = state;

  const llm = new ChatOpenAI({
    openAIApiKey: settings.apiKey,
    configuration: { baseURL: `${settings.endpoint}/chat/completions` },
    modelName: settings.model,
    temperature: 0.6,
  });

  const stateSummary = (deviceList || [])
    .map(d => `- [${d.room}] ${d.name}: ${d.type === 'digital' ? (d.on ? 'ON' : 'OFF') : `${d.value}/${d.max ?? 255}`}`)
    .join('\n') || 'No devices registered';

  const systemPrompt = `${settings.systemPrompt}
(Current date & time: ${nowString()})
[Current Home Status]
${stateSummary}

[IMPORTANT GUARDRAILS]
- If the user asks to control a device or run a command, and the [Tool Results] indicates NO tools were executed or a tool failed, you MUST NOT pretend the action was successful. Apologize and state the failure.`;

  const messages = [
    new SystemMessage(systemPrompt),
    ...apiHistory.map(m => m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)),
  ];

  if (allToolResults.length > 0) {
    const toolSummary = allToolResults.map(r => `[${r.name}] ${JSON.stringify(r.result)}`).join('\n');
    messages.push(new HumanMessage(`${text}\n\n[System: Tool Results]\n${toolSummary}`));
  } else {
    messages.push(new HumanMessage(`${text}\n\n[System: No tools were executed for this request.]`));
  }

  // ✨ จัดการ Streaming ให้ส่งกลับไปที่หน้า UI ทีละตัวอักษร
  let replyText = "";
  const stream = await llm.stream(messages, { signal });
  for await (const chunk of stream) {
    if (chunk.content) {
      replyText += chunk.content;
      onStream?.(chunk.content);
    }
  }

  return { reply: replyText };
}

// ── 3. Graph Construction ────────────────────────────────────────────────
const workflow = new StateGraph(AgentState)
  .addNode("router", routerNode)
  .addNode("toolExecutor", toolExecutorNode)
  .addNode("responder", responderNode)
  .addEdge(START, "router")
  .addConditionalEdges("router", (state) => {
    return state.toolCalls?.length > 0 ? "toolExecutor" : "responder";
  })
  .addEdge("toolExecutor", "router") // ✨ ReAct Loop
  .addEdge("responder", END);

const compiledGraph = workflow.compile();

// ── 4. Public API ────────────────────────────────────────────────────────
export const runAgent = async (params) => {
  // รัน Graph
  const finalState = await compiledGraph.invoke({
    ...params,
    allToolResults: [],
    toolRound: 0,
    toolCalls: []
  });
  return { reply: finalState.reply, allToolResults: finalState.allToolResults };
};

// ── 5. Sub-agents (ยังต้องใช้ใน agentSkills.js) ─────────────────────────

export async function generateOsCommand({ settings, instruction, os, signal }) {
  const llm = new ChatOpenAI({
    openAIApiKey: settings.apiKey,
    configuration: { baseURL: `${settings.endpoint}/chat/completions` },
    modelName: settings.model,
    temperature: 0,
  });

  const OS_COMMAND_SYSTEM = `You are a terminal command translator for remote machine control.
Given a natural-language instruction and a target OS, output the exact terminal command to execute.
Output ONLY the raw command string — no explanation, no markdown.
If unsafe, output exactly: UNSAFE`;

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
    openAIApiKey: settings.apiKey,
    configuration: { baseURL: `${settings.endpoint}/chat/completions` },
    modelName: settings.model,
    temperature: 0.1,
  });

  const SEARCH_QUERY_SYSTEM = `You are a Search Context Optimizer.
Output ONLY the raw search query string based on the user intent. Remove conversational fillers.`;

  const recentHistory = (apiHistory || []).slice(-4).map(m =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  );

  const messages = [
    new SystemMessage(SEARCH_QUERY_SYSTEM),
    ...recentHistory,
    new HumanMessage(`Router intended query: "${query}"\nPlease output the optimized search query:`)
  ];

  try {
    const response = await llm.invoke(messages, { signal });
    return response.content.trim() || query;
  } catch (err) {
    return query;
  }
}