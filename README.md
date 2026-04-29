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
│  │   [agent]  temp=0.2 │◄────────┐       │
│  │  รู้เวลาปัจจุบัน    │         │       │
│  │  รู้ device list    │         │       │
│  │  เลือก tool หรือ   │         │       │
│  │  ตอบตรง            │         │       │
│  └──────┬──────────────┘         │       │
│         │ tool_calls?            │       │
│    ┌────┴─────────────────┐      │       │
│    │  มี tool calls       │      │       │
│    │         ▼            │  ────┘       │
│    │  [tools]             │  ↑ loop      │
│    │  รัน parallel        │  (max 3 รอบ) │
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
├── App.jsx                   # Root — orchestrates state, MQTT, tools
├── data.js                   # ค่าเริ่มต้น (devices, settings, areas, tweaks)
├── index.css                 # Tailwind + ระบบ theme (dark/light, oklch)
├── hooks/
│   ├── useMQTT.js            # MQTT connection, publish, sensorCache, waitForMessage
│   └── useChat.js            # Chat messages, agent loop, streaming, history limit
├── utils/
│   ├── agent.js              # LangGraph ReAct graph + LLM client + OS/search sub-agents
│   ├── agentSkills.js        # Skill handlers (mqtt_publish, mqtt_read, os_command, web_search)
│   ├── mqttTopic.js          # normalizeBase / buildFullTopic helpers
│   └── storage.js            # localStorage helpers
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
    ├── SettingsPage.jsx      # 7 sections + QR export/import
    └── TweaksPanel.jsx       # Live theme editor

build_com_agent/
├── terminal_agent.py         # Python MQTT agent รับคำสั่งแล้วรัน terminal จริงบนเครื่อง
└── terminal_agent.exe        # Pre-built binary สำหรับ Windows
```

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
- เก็บประวัติแชท **10 ข้อความล่าสุด** เพื่อประหยัด token

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
- `temperature=0.2` · stream คำตอบทีละ token ขณะที่ไม่มี tool call

### Tools Node

- รัน tool calls **พร้อมกันทั้งหมด** (Promise.all) — ไม่รอทีละตัว
- UI แสดง ToolPill แต่ละตัวพร้อม label `R1` / `R2` / ... บอก round
- ผล tool ถูกแปลงเป็น `ToolMessage` และส่งกลับเข้า agent node เพื่อ reasoning ต่อ

### ReAct Loop

- หลัง tools รัน agent จะ reason ต่อว่า "ครบหรือยัง?" — ถ้ายังขาดอยู่จะเรียก tool รอบใหม่
- tool ที่ disabled จะถูกบล็อกทั้งที่ชั้น tool list (LLM ไม่เห็น) และที่ชั้น execution

### Sub-Agents (ไม่ขึ้น Graph)

| Sub-Agent | หน้าที่ | temp |
|---|---|---|
| `generateOsCommand` | แปลภาษาคนเป็น terminal command ก่อนส่ง MQTT · ปฏิเสธคำสั่ง destructive | 0 |
| `generateSearchQuery` | optimize คำค้นก่อนยิง Serper API | 0.1 |

---

## Skills (Built-in)

| Skill | หน้าที่ | ต้องการ |
|---|---|---|
| `mqtt_publish` | publish payload ไปยัง device topic | MQTT |
| `mqtt_read` | อ่านค่าล่าสุดจาก sensor topic | MQTT |
| `os_command` | แปลภาษาคนเป็น terminal command แล้วส่งไปยัง os_terminal device | MQTT |
| `web_search` | ค้นหาข้อมูลผ่าน Serper API · ผลดิบส่งตรงไปยัง agent context | Serper API Key |

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
- รัน command จริงด้วย `subprocess.getoutput()`
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
