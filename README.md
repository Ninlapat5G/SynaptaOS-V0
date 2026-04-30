# SynaptaOS — Smart Home Dashboard

AI-powered smart home dashboard พูดภาษาไทย ควบคุมอุปกรณ์ผ่าน MQTT และสั่งรัน terminal command บนคอมพิวเตอร์ remote ผ่าน MCP + CrewAI

---

## วิธีการใช้งาน

### 1. ตั้งค่าครั้งแรก

ไปที่หน้า **Settings** แล้วกรอก:
- **API Endpoint** + **API Key** + **Model** (Section 02 Language Model)
- **MQTT Broker URL** (Section 05) — ค่าเริ่มต้นใช้ HiveMQ public broker ได้เลย
- **Profile** (Section 01) — แนะนำตัวกับ AI เพื่อให้ตอบกลับได้ตรงใจกว่าเดิม เช่น "ชื่อ Mira ชอบตอบสั้น"

> ตั้งชื่อ Assistant ได้ใน System Prompt เช่น `"ชื่อของเธอคือ Aria"` — แอปจะตรวจจับและอัปเดตชื่อในหน้าแชทอัตโนมัติ

### 2. เพิ่มอุปกรณ์

ไปที่หน้า **Devices** → เลือกประเภท:

| ปุ่ม | ประเภท | หน้าที่ |
|---|---|---|
| **Add Device** | digital / analog | อุปกรณ์ IoT ทั่วไป ควบคุมผ่าน MQTT |
| **Add Terminal** | os_terminal | คอมพิวเตอร์ remote ควบคุมผ่าน MQTT (เดิม) |
| **Add WS Terminal** | ws_terminal | คอมพิวเตอร์ remote ผ่าน MCP + CrewAI (beta) |

### 3. สั่งงานผ่าน AI Chat

ไปที่หน้า **AI Chat** แล้วพิมพ์หรือพูดคำสั่งได้เลย:

| ตัวอย่างคำสั่ง | ผลลัพธ์ |
|---|---|
| `เปิดไฟห้องนั่งเล่น` | เปิด device ที่กำหนด |
| `หรี่แสงลงครึ่งนึง` | คำนวณค่าแล้ว publish |
| `ปิดไฟทั้งบ้าน` | สั่งทุก device พร้อมกัน |
| `เปิดเพลง [ชื่อเพลง]` | ค้นหา YouTube แล้วเปิดทันที |
| `รันคำสั่ง dir บนเครื่อง office-pc` | remote_shell ผ่าน MCP |

---

## remote_shell (MCP + CrewAI)

feature ใหม่สำหรับควบคุม terminal บนคอมพิวเตอร์ remote โดยไม่ต้องผ่าน MQTT broker

### สถาปัตยกรรม

```
Web App (Browser)
    ↓ POST /run
MCP Server (Python · port 8000)
    ├── CrewAI Crew
    │     ├── Safety Agent  — ตรวจสอบความปลอดภัยของ task
    │     └── CommandAgent  — แปล task → OS command
    ↕ WebSocket (port 8001)
Terminal Agent (บนเครื่อง remote)
    └── รัน command → stream output → ส่ง (mcp_end)
```

### ติดตั้งและรัน

**1. สร้าง .env**
```bash
cd mcp_server
cp .env.example .env
# แก้ LLM_API_KEY, LLM_BASE_URL, LLM_MODEL
```

**2. รัน MCP server**
```bash
conda run -n crew-agent python mcp_server/server.py
```

**3. รัน terminal agent บนเครื่อง remote**
```bash
conda run -n crew-agent python terminal_agent/agent.py office-pc ws://MCP_SERVER_IP:8001
```

**4. เปิด MCP mode ใน Settings**
- Settings → Skills → `remote_shell` → Backend → **MCP Server (beta)**
- กรอก MCP Server URL: `http://MCP_SERVER_IP:8000`

**5. เพิ่ม WS Terminal device**
- Devices → **Add WS Terminal** → ใส่ Agent Name ให้ตรงกับที่ terminal agent ใช้

### โครงสร้างไฟล์ MCP

```
mcp_server/
├── server.py       # FastAPI REST (/run, /agents) + FastMCP (/mcp) + asyncio WS
├── crew.py         # CrewAI agents (Safety + CommandAgent, sequential)
├── ws_registry.py  # Registry ของ WebSocket connections จาก terminal agents
├── config.py       # Settings จาก .env
├── .env.example    # Template
└── requirements.txt

terminal_agent/
└── agent.py        # ติดตั้งบนเครื่อง remote — connect WS, รัน command, stream output
```

---

## คอนเซปของงาน

ผู้ใช้**พิมพ์หรือพูด**เป็นภาษาไทย (หรืออังกฤษ) เพื่อควบคุมอุปกรณ์บ้าน — AI จะแปลคำพูดเป็นคำสั่ง MQTT และส่งไปยังอุปกรณ์จริงโดยอัตโนมัติ โดยไม่ต้องกดปุ่มหรือเลื่อน slider เอง

ทุกอย่าง **BYOK** (Bring Your Own Key) — ไม่มี backend กลาง ข้อมูลเก็บใน `localStorage` ทั้งหมด (ยกเว้น MCP server ที่ user รันเอง)

---

## Framework ที่ใช้

| ส่วน | เทคโนโลยี |
|---|---|
| UI | React 18 + Vite 5 |
| Styling | Tailwind CSS v3 + CSS custom properties (oklch) |
| Animation | Framer Motion |
| AI / Agent | LangGraph (`@langchain/langgraph`) + `@langchain/openai` |
| IoT Protocol | MQTT over WebSocket — `mqtt.js` v5 · QoS 2 |
| Remote Shell | FastAPI + FastMCP + CrewAI + WebSocket (Python) |
| Multi-Agent | CrewAI (Safety Agent + Command Agent · sequential process) |
| Voice Input | Web Speech API (Chrome/Edge) |
| Markdown | `react-markdown` |
| Storage | localStorage — ไม่มี backend |
| Deploy | Vercel (static site) |

---

## สถาปัตยกรรมระบบ

```
ผู้ใช้พิมพ์/พูด
       │
       ▼
┌─────────────────────────────────────┐
│         LangGraph ReAct Loop        │
│                                     │
│  [agent node]  ←──────────┐         │
│  · รู้เวลาปัจจุบัน        │         │
│  · รู้ device list        │  ReAct  │
│  · เลือก tool หรือตอบตรง  │  loop   │
│         │                 │         │
│         ▼ tool_calls?     │         │
│  [tools node]             │         │
│  · รัน parallel           ─┘         │
│  · Promise.all                      │
│  · ส่งผล ToolMessage กลับ           │
│                                     │
│  ไม่มี tool calls → END → stream   │
└─────────────────────────────────────┘
       │
       ├── MQTT publish → IoT devices
       │
       └── remote_shell → POST /run → MCP Server
                               └── CrewAI → WebSocket → Terminal Agent
```

### โครงสร้างไฟล์

```
src/
├── utils/
│   ├── agent.js          # LangGraph graph + sub-agents
│   ├── agent_prompt.js   # System prompts ทั้งหมด
│   ├── agentSkills.js    # Tool handlers (mqtt_publish, mqtt_read, os_command, web_search, remote_shell)
│   ├── remoteShell.js    # remote_shell skill — browser mode + MCP mode + fallback
│   ├── mqttTopic.js      # Topic normalize helpers
│   └── storage.js        # localStorage helpers
├── hooks/
│   ├── useSettings.js    # Settings + auto-detect assistant name
│   ├── useDevices.js     # Device list + MQTT sync
│   ├── useMQTT.js        # MQTT client, publish, waitForStream
│   ├── useChat.js        # Chat state + streaming
│   └── useAreas.js       # Room filter
└── components/
    ├── DeviceCard.jsx    # digital / analog / os_terminal / ws_terminal widgets
    ├── ChatPage.jsx      # AI Chat UI
    └── SettingsPage.jsx  # 7 sections + remote_shell backend toggle
```

### Skills (Tools ที่ AI เรียกได้)

| Skill | หน้าที่ | Device type |
|---|---|---|
| `mqtt_publish` | ส่ง payload ไปยัง device | digital / analog |
| `mqtt_read` | อ่านสถานะปัจจุบันจาก device | digital / analog |
| `os_command` | แปลภาษา → command → MQTT (เดิม) | os_terminal |
| `remote_shell` | task → CrewAI → WebSocket → output (beta) | ws_terminal |
| `web_search` | ค้นหาผ่าน Serper API | — |

### Device Types

| Type | ควบคุมด้วย | Transport |
|---|---|---|
| `digital` | mqtt_publish / mqtt_read | MQTT WebSocket |
| `analog` | mqtt_publish / mqtt_read | MQTT WebSocket |
| `os_terminal` | os_command | MQTT WebSocket |
| `ws_terminal` | remote_shell (MCP mode) | WebSocket → MCP Server |

### MQTT Default

- Broker: `wss://broker.hivemq.com:8884/mqtt` (public, ไม่ต้อง login)
- Base Topic: `Mylab/smarthome`
- Full topic = `{Base Topic}/{suffix}` — normalize ให้อัตโนมัติ
