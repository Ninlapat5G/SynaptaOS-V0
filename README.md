# AIoT Smart Home Dashboard

ระบบควบคุมบ้านอัจฉริยะ พร้อม AI Assistant ที่สั่งงานอุปกรณ์ IoT ผ่าน MQTT แบบ Real-time
สร้างด้วย React + Tailwind CSS + Framer Motion และ LLM ที่รองรับ OpenAI-compatible API

---

## คอนเซปต์

โปรเจคนี้เชื่อม AI เข้ากับโลก IoT จริง — ผู้ใช้**พูดหรือพิมพ์**เป็นภาษาไทย (หรืออังกฤษ) เพื่อควบคุมอุปกรณ์บ้าน เช่น เปิดไฟ หรี่แสง ปิด AC โดยไม่ต้องกดปุ่มหรือเลื่อน slider เอง

ทุกอย่าง BYOK (Bring Your Own Key) — ไม่มี backend, ไม่มี server, เก็บข้อมูลใน localStorage

---

## Architecture

```text
ผู้ใช้พิมพ์/พูด
       │
       ▼
┌──────────────────────────────────────────┐
│         LangGraph ReAct Loop             │
│                                          │
│  ┌─────────────────────┐                 │
│  │   [agent]            │◄────────┐       │
│  │  รู้เวลาปัจจุบัน    │         │       │
│  │  รู้ device list    │         │       │
│  │  เลือก tool หรือ   │         │       │
│  │  ตอบตรง            │         │       │
│  └──────┬──────────────┘         │       │
│         │ tool_calls?            │       │
│    ┌────┴─────────────────┐      │       │
│    │  มี tool calls       │      │       │
│    │         ▼            │  ────┘       │
│    │  [tools]             │  ↑ ReAct     │
│    │  รัน parallel        │              │
│    │  Promise.all         │              │
│    │  ✅ ToolMessage ส่ง  │              │
│    │  กลับให้ agent       │              │
│    └──────────────────────┘              │
│                                          │
│    ไม่มี tool calls → END (ตอบ user)    │
│    (stream คำตอบให้ user ทันที)          │
└──────────────────────────────────────────┘
       │
       ▼
Device Cards อัปเดต real-time (MQTT QoS 2)
```

---

## Tech Stack

| ส่วน | เทคโนโลยี |
|---|---|
| UI Framework | React 18 + Vite 5 |
| Styling | Tailwind CSS v3 + CSS custom properties (`oklch`) |
| Animation | Framer Motion (spring, stagger, AnimatePresence, useMotionValue) |
| Markdown | `react-markdown` — AI responses render bold, lists, code blocks, clickable links |
| IoT Protocol | MQTT over WebSocket — `mqtt.js` v5 · **QoS 2** · auto-reconnect |
| AI / LLM | OpenAI-compatible API · รองรับ Typhoon, OpenAI, OpenRouter, Ollama และทุก provider ที่ใช้ `/chat/completions` |
| Agent Engine | **LangGraph** (`@langchain/langgraph`) — ReAct loop: agent ↔ tools |
| LLM Client | `@langchain/openai` + `@langchain/core` |
| Voice | Web Speech API (Chrome/Edge) |
| Storage | `localStorage` — ไม่มี backend |
| Deployment | Vercel (static site) |

---

## โครงสร้างโปรเจค

```text
src/
├── App.jsx                   # Root — wires hooks together, renders pages (~250 lines)
├── data.js                   # ค่าเริ่มต้น (devices, settings, areas, tweaks)
├── index.css                 # Tailwind + ระบบ theme (dark/light, oklch)
│
├── hooks/
│   ├── useSettings.js        # Settings state + localStorage + baseTopicRef
│   ├── useDevices.js         # Device list + MQTT→state sync + removeDevice
│   ├── useAreas.js           # Room filter list + editor UI state
│   ├── useMQTT.js            # MQTT client, publish, waitForMessage, waitForStream
│   └── useChat.js            # Chat state, runAgent call, streaming, abort
│
├── utils/
│   ├── agent.js              # LangGraph ReAct graph + LLM client + sub-agents
│   │                         # Sub-agents: generateOsCommand, generateSearchQuery
│   ├── agentSkills.js        # Tool handlers ← เพิ่ม skill ใหม่ที่นี่
│   │                         # (mqtt_publish, mqtt_read, os_command, web_search)
│   ├── mqttTopic.js          # normalizeBase / buildFullTopic helpers
│   └── storage.js            # localStorage helpers
│
└── components/
    ├── ui/
    │   ├── Icon.jsx
    │   ├── Toggle.jsx
    │   └── Slider.jsx
    ├── chat/
    │   ├── ChatBubble.jsx
    │   └── ToolPill.jsx
    ├── ErrorBoundary.jsx
    ├── Nav.jsx
    ├── DeviceCard.jsx        # digital / analog / os_terminal device types
    ├── ChatPage.jsx          # AI Chat + Voice input + Stop button
    ├── SettingsPage.jsx      # 7 sections
    └── TweaksPanel.jsx       # Live theme editor

build_com_agent/
├── terminal_agent.py         # Python MQTT agent รับคำสั่งแล้วรัน terminal จริงบนเครื่อง
└── terminal_agent.exe        # Pre-built binary สำหรับ Windows
```

### วิธีเพิ่ม Skill ใหม่

1. **เขียน handler** ใน `src/utils/agentSkills.js`:
```js
async function mySkill(args, ctx) {
  // ctx = { mqttClient, settings, devicesRef, baseTopicRef, setDevices, ... }
  return { success: true, result: '...' }
}
```

2. **ลงทะเบียน** ใน `toolHandlers`:
```js
const toolHandlers = { ..., my_skill: mySkill }
```

3. **เพิ่ม schema** ใน `DEFAULT_SETTINGS.skills` (`src/data.js`):
```js
{
  id: 'my_skill', name: 'my_skill',
  description: 'What this tool does (seen by the LLM)',
  enabled: true,
  schema: '{"type":"object","properties":{"param":{"type":"string"}},"required":["param"]}',
}
```

ไม่ต้องแตะไฟล์อื่น — agent จะเห็น skill ใหม่ทันที

---

## วิธีติดตั้งและรัน

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build
```

### ตั้งค่าครั้งแรก

1. เปิดแอป → ไปที่หน้า **Settings**
2. กรอก **API Endpoint**, **API Key**, **Model**
3. ไปที่หน้า **AI Chat** แล้วลองพิมพ์ เช่น _"เปิดไฟห้องนั่งเล่น"_

**ตัวอย่าง provider ที่ใช้ได้:**

| Provider | Endpoint | หมายเหตุ |
|---|---|---|
| Typhoon AI | `https://api.opentyphoon.ai/v1` | ค่าเริ่มต้น · เก่งภาษาไทย |
| OpenRouter | `https://openrouter.ai/api/v1` | รวม model หลายร้อยตัว |
| OpenAI | `https://api.openai.com/v1` | — |
| Ollama (local) | `http://localhost:11434/v1` | ไม่ต้องใช้ internet |

**Typhoon AI — รายการ model แนะนำ (ณ เมษายน 2025):**

| Model ID | Context | หมายเหตุ |
|---|---|---|
| `typhoon-v2.5-30b-a3b-instruct` | 128K | **ค่าเริ่มต้น** · flagship · เก่งทั้ง tool use และ Thai |
| `typhoon-v2.1-12b-instruct` | 56K | เล็กกว่า · เร็วกว่า · ประหยัด token |
| `typhoon-v2-r1-70b-instruct` | 128K | reasoning model · เหมาะกับคำสั่งซับซ้อน |

---

## ฟีเจอร์ระบบ

### หน้า Devices

- สถานะอุปกรณ์ real-time ผ่าน MQTT
- **Digital** — toggle เปิด/ปิด
- **Analog** — slider + animated readout
- **Terminal** — widget ส่ง raw MQTT command โดยตรง สำหรับ dev
- กด ⚙ เพื่อแก้ไขชื่อ, ห้อง, ประเภท, MQTT topics
- กด **+ Add Device** / **+ Add Terminal** เพื่อเพิ่มใหม่
- Banner แจ้งเตือนเมื่อ MQTT reconnecting / error

### หน้า AI Chat

ตอบกลับแบบ **streaming** — เห็นคำตอบทีละตัวอักษร

- พิมพ์หรือกดไมค์พูด (ภาษาไทย/อังกฤษ)
- ปุ่มหยุดระหว่าง AI กำลังคิดหรือรัน tool
- เก็บประวัติแชทล่าสุด **30 ข้อความ** (pre-filter) → trim ด้วย **token budget 20,000 tokens** ก่อนส่ง LLM — รองรับ ~30 turns โดยไม่ overflow แม้ web_search คืนผลยาว

| ตัวอย่างคำสั่ง | ผลลัพธ์ |
|---|---|
| `เปิดไฟห้องนั่งเล่น` | publish `true` ไปที่ lamp |
| `หรี่แสงลงครึ่งนึง` | คำนวณ `max/2` แล้ว publish |
| `ปิดไฟทั้งบ้าน` | หลาย tool calls ในคำสั่งเดียว (Parallel execution) |
| `ตอนนี้ไฟเปิดกี่ดวง` | อ่าน state จาก context ตอบทันที ไม่เรียก tool |

### หน้า Settings

| Section | รายละเอียด |
|---|---|
| 01 Profile | Display Name (ชื่อที่ AI เรียก) · Assistant Name (ชื่อที่แสดงใน Chat UI) |
| 02 Language Model | Endpoint · API Key · Model · System Prompt |
| 03 Skills | เปิด/ปิด tool หรือเพิ่ม custom tool พร้อม JSON Schema |
| 04 Integrations | Serper API Key สำหรับ web_search skill |
| 05 MQTT Broker | URL · Port · Base Topic · สถานะการเชื่อมต่อ |
| 06 Share Configuration | Copy/Paste JSON เพื่อย้าย config ข้ามเครื่อง |
| 07 Data | ปุ่ม Clear all local data |

---

## Agent ทำงานยังไง (LangGraph ReAct)

สถาปัตยกรรมใช้ **LangGraph ReAct loop** — agent ตัดสินใจเองว่าจะเรียก tool อีกรอบหรือตอบ user โดยตรง

### Agent Node

- รู้ **วันเวลาปัจจุบัน** — formulate web search query ได้ถูกต้อง เช่น "ข่าววันนี้" → query ที่ระบุวันที่จริง
- ได้รับ device list (human-readable summary ไม่ใช่ raw JSON) + skills ที่เปิด + ประวัติสนทนา
- รองรับคำสั่ง **ตรง** ("เปิดไฟ") และ **อ้อมค้อม** ("มืดมากเลย" → เปิดไฟ)
- **IRONCLAD RULE — Device Awareness**: ถ้าคำสั่งชี้ไปที่อุปกรณ์ที่ไม่มีในลิสต์ จะ**ไม่ publish ทันที** — จะแจ้ง user ก่อนและขอให้ยืนยัน + ระบุ MQTT topic เองก่อน
- `temperature=0.1` (round 0 — tool selection) · `temperature=0.5` (round ถัดไป — synthesis/response) · stream ทีละ token

### Tools Node

- รัน tool calls **พร้อมกันทั้งหมด** (Promise.all) — ไม่รอทีละตัว
- UI แสดง ToolPill แต่ละตัวพร้อม label `R1` / `R2` / ... บอก round
- ผล tool ถูกแปลงเป็น `ToolMessage` และส่งกลับเข้า agent node เพื่อ reasoning ต่อ

### ReAct Loop

- หลัง tools รัน agent จะ reason ต่อว่า "ครบหรือยัง?" — ถ้ายังขาดอยู่จะเรียก tool รอบใหม่
- tool ที่ disabled จะถูกบล็อกทั้งที่ชั้น tool list (LLM ไม่เห็น) และที่ชั้น execution

### Sub-Agents (ไม่ขึ้น Graph)

| Sub-Agent | หน้าที่ | temp | output |
|---|---|---|---|
| `generateOsCommand` | แปลภาษาคนเป็น terminal command ก่อนส่ง MQTT · ปฏิเสธคำสั่ง destructive | 0 | structured `{ command }` |
| `generateSearchQuery` | optimize คำค้นก่อนยิง Serper API · ดึง 3 ผลลัพธ์ | 0.1 | structured `{ query }` |

---

## Skills (Built-in)

| Skill | หน้าที่ | มองเห็น device ประเภท | ต้องการ |
|---|---|---|---|
| `mqtt_publish` | publish payload ไปยัง device topic | digital, analog เท่านั้น | MQTT |
| `mqtt_read` | อ่านค่าล่าสุดจาก sensor topic | digital, analog เท่านั้น | MQTT |
| `os_command` | แปลภาษาคนเป็น terminal command แล้วส่งผ่าน MQTT | os_terminal เท่านั้น | MQTT |
| `web_search` | ค้นหาข้อมูลผ่าน Serper API · ผลดิบส่งตรงไปยัง agent context | — | Serper API Key |

> **การแยก terminal ออกจาก mqtt_publish:** `mqtt_publish` และ `mqtt_read` จะ**ไม่เห็น** os_terminal device เลย — ถ้า AI พยายาม publish ตรงไปที่ terminal topic จะได้รับ error และถูกบอกให้ใช้ `os_command` แทน ป้องกันการส่งคำสั่ง raw ข้ามไปยัง terminal agent

เปิด/ปิด skill ได้ที่ Settings → Section 03 — skill ที่ปิดจะถูกบล็อกทั้งจาก tool list ที่ LLM เห็น และที่ชั้น execution ดังนั้น tool ที่ disabled จะไม่ทำงานได้แม้ในกรณี prompt injection

เพิ่ม custom skill ได้ที่ Settings → Section 03 — กำหนด name, description, JSON Schema ได้อิสระ

> **web_search** ต้องใส่ Serper API Key ที่ Settings → 04 Integrations · รับ key ฟรีได้ที่ [serper.dev](https://serper.dev) (Free tier: 2,500 queries)

---

## Terminal Agent (build_com_agent)

Python agent สำหรับรัน terminal command จริงบนเครื่อง PC ผ่าน MQTT

```bash
# รันบนเครื่องที่ต้องการควบคุม
python terminal_agent.py office-pc
# หรือใช้ binary (Windows)
terminal_agent.exe office-pc
```

- subscribe topic `Mylab/smarthome/{computer_name}/cmd`
- รัน command จริงด้วย `subprocess.Popen` (streaming ทีละบรรทัด)
- ส่ง output ทีละบรรทัดผ่าน MQTT → แอปรับทีละ chunk จนครบ → ส่งทั้งหมดให้ agent ในที
- ส่ง `(mqtt_end)` เสมอเมื่อ command จบ (รวมถึงกรณี error)
- รองรับ `cd` (อัปเดต working directory จริง)
- publish output กลับที่ `Mylab/smarthome/{computer_name}/output`
- เชื่อมต่อด้วย TLS (port 8883)

สร้าง device ประเภท `os_terminal` ในแอปแล้วชี้ pubTopic ไปที่ `/cmd` topic ของเครื่อง จากนั้น AI จะแปลคำสั่งภาษาไทยแล้วรันได้ทันที

---

## MQTT Topics (ค่าเริ่มต้น)

Broker: `wss://broker.hivemq.com:8884/mqtt` (public, ไม่ต้อง login)
Base Topic: `Mylab/smarthome`

Full topic = `{Base Topic}/{suffix}` — ระบบ normalize ให้อัตโนมัติ ไม่ต้องพิมพ์ซ้ำ

---

## Deploy บน Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Ninlapat5G/AIoT-Project)

> ต้องใช้ `wss://` (port 8884) เมื่อ deploy บน HTTPS — broker.hivemq.com รองรับอยู่แล้ว
> Voice input ทำงานเฉพาะบน HTTPS และใน Chrome/Edge

---

## License

MIT
