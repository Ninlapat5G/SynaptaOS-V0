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
│            Mini Agent Graph              │
│                                          │
│  [router]  temp=0.1                      │
│   รู้เวลาปัจจุบัน · เลือก tool           │
│   รองรับคำสั่งตรงและอ้อมค้อม            │
│       │                  │               │
│  มี tool calls       ไม่มี tool calls    │
│       ▼                  ▼               │
│  [tool_executor]    [responder]          │
│   รันพร้อมกัน (parallel)                │
│       │                                  │
│   web_search? → [synthesizer]            │
│   ดึงข้อมูล → สรุปก่อนส่งต่อ            │
│       │                                  │
│   shouldRunPlanner?                      │
│   (ข้ามถ้า mqtt_publish ล้วนๆ)           │
│       ▼                                  │
│  [planner]  temp=0.1                     │
│   completion checker — ครบมั้ย?          │
│   อ่าน summary ไม่ใช่ raw JSON           │
│       │                                  │
│       ▼                                  │
│  [responder]  temp=0.7                   │
│   รู้เวลาปัจจุบัน · streaming            │
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
| Agent | Mini graph engine — router → tool_executor → planner → responder |
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
│   ├── agent.js              # Graph engine + LLM client + os command generator + strict filtering
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
    ├── SettingsPage.jsx      # 6 sections + JSON export/import
    └── TweaksPanel.jsx       # Live theme editor
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

## Agent ทำงานยังไง

### Router Node — ตัดสินใจ

- รู้ **วันเวลาปัจจุบัน** — formulate web search query ได้ถูกต้อง เช่น "ข่าววันนี้" → query ที่ระบุวันที่จริง
- ได้รับ device list (human-readable summary ไม่ใช่ raw JSON) + skills ที่เปิด + ประวัติสนทนา
- รองรับคำสั่ง **ตรง** ("เปิดไฟ") และ **อ้อมค้อม** ("มืดมากเลย" → เปิดไฟ)
- guard ชัดเจน: ไม่เรียก tool สำหรับ greetings / small talk / คำถามเกี่ยวกับตัว AI
- `temperature=0.1` · คืน `tool_calls[]` เท่านั้น

### Tool Executor Node — รันจริง

- รัน tool calls **พร้อมกันทั้งหมด** (Promise.all)
- UI แสดง ToolPill แต่ละตัวพร้อม label `R1` / `R2` บอก round
- **web_search** ดึงข้อมูลจาก Serper แล้วแปลงเป็น plain text ทันที (answerBox + knowledgeGraph + organic snippets) — ส่งเนื้อหาครบถ้วนต่อให้ responder โดยไม่ผ่าน LLM summarizer เพื่อไม่ให้สาระสำคัญหาย

### Planner Node — Completion Checker (R2)

- ทำงานเป็น **completion checker** ไม่ใช่ planner ทั่วไป — ถามว่า "ครบทุก target มั้ย?"
- อ่าน executed results ในรูป human-readable (`✅ mqtt_publish → Lamp (Living Room) = true`) ไม่ใช่ raw JSON
- ใช้ประวัติสนทนาเพื่อ resolve multi-turn reference เช่น "ทำแบบเดิมกับห้องนั่งเล่นด้วย"
- ข้าม planner อัตโนมัติถ้า round 1 มีแค่ mqtt_publish สำเร็จ (ไม่มีข้อมูลใหม่ให้คิด)
- tool ที่ succeed แล้วจะไม่ถูกเรียกซ้ำ — retry เฉพาะ target ที่ fail หรือยังขาดอยู่

### Responder Node — ตอบผู้ใช้

- รู้ **วันเวลาปัจจุบัน** — ตอบคำถาม time-sensitive ได้แม่นยำ แต่ไม่บอกเวลาโดยไม่จำเป็น
- เห็น device state เฉพาะตอนที่ไม่มี tool รัน (ป้องกัน snapshot เก่าขัดแย้งกับ tool result)
- `temperature=0.7` · stream คำตอบทีละ token

---

## Skills (Built-in)

| Skill | หน้าที่ | ต้องการ |
|---|---|---|
| `mqtt_publish` | publish payload ไปยัง device topic | MQTT |
| `mqtt_read` | อ่านค่าล่าสุดจาก sensor topic | MQTT |
| `os_command` | แปลภาษาคนเป็น terminal command แล้วส่งไปยัง os_terminal device | MQTT |
| `web_search` | ค้นหาข้อมูลผ่าน Serper API → synthesizer สรุปผลก่อนส่ง agent | Serper API Key |

เปิด/ปิด skill ได้ที่ Settings → Section 03 — skill ที่ปิดจะถูกบล็อกทั้งจาก tool list ที่ LLM เห็น และที่ชั้น execution ดังนั้น tool ที่ disabled จะไม่ทำงานได้แม้ในกรณี prompt injection

เพิ่ม custom skill ได้ที่ Settings → Section 03 — กำหนด name, description, JSON Schema ได้อิสระ

> **web_search** ต้องใส่ Serper API Key ที่ Settings → 04 Integrations · รับ key ฟรีได้ที่ [serper.dev](https://serper.dev) (Free tier: 2,500 queries)

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