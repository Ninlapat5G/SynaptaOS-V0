# AIoT Smart Home Dashboard

## วิธีการใช้งาน

### 1. ตั้งค่าครั้งแรก

ไปที่หน้า **Settings** แล้วกรอก:
- **API Endpoint** + **API Key** + **Model** (Section 02 Language Model)
- **MQTT Broker URL** (Section 05) — ค่าเริ่มต้นใช้ HiveMQ public broker ได้เลย

> ตั้งชื่อ Assistant ได้ใน System Prompt เช่น `"ชื่อของเธอคือ Aria"` — แอปจะตรวจจับและอัปเดตชื่อในหน้าแชทอัตโนมัติ

### 2. เพิ่มอุปกรณ์

ไปที่หน้า **Devices** → กด **+ Add Device** แล้วกรอก:
- ชื่ออุปกรณ์ + ห้อง + ประเภท (digital / analog)
- MQTT topic ที่ใช้รับคำสั่ง (pubTopic) และรายงานสถานะ (subTopic)

### 3. สั่งงานผ่าน AI Chat

ไปที่หน้า **AI Chat** แล้วพิมพ์หรือพูดคำสั่งได้เลย:

| ตัวอย่างคำสั่ง | ผลลัพธ์ |
|---|---|
| `เปิดไฟห้องนั่งเล่น` | เปิด device ที่กำหนด |
| `หรี่แสงลงครึ่งนึง` | คำนวณค่าแล้ว publish |
| `ปิดไฟทั้งบ้าน` | สั่งทุก device พร้อมกัน |
| `เปิดเพลง [ชื่อเพลง]` | ค้นหา YouTube แล้วเปิดทันที |
| `ตอนนี้ไฟเปิดกี่ดวง` | ตอบจาก context ไม่ต้อง publish |

---

## คอนเซปของงาน

ผู้ใช้**พิมพ์หรือพูด**เป็นภาษาไทย (หรืออังกฤษ) เพื่อควบคุมอุปกรณ์บ้าน — AI จะแปลคำพูดเป็นคำสั่ง MQTT และส่งไปยังอุปกรณ์จริงโดยอัตโนมัติ โดยไม่ต้องกดปุ่มหรือเลื่อน slider เอง

**ตัวอย่างคำสั่ง:**

| พิมพ์ | ผลลัพธ์ |
|---|---|
| `เปิดไฟห้องนั่งเล่น` | publish `true` ไปที่ lamp topic |
| `หรี่แสงลงครึ่งนึง` | คำนวณ `max/2` แล้ว publish |
| `ปิดไฟทั้งบ้าน` | tool calls แบบ parallel หลายรายการ |
| `รัน dir บนเครื่อง office` | แปลเป็น terminal command แล้วส่งผ่าน MQTT |

ทุกอย่าง **BYOK** (Bring Your Own Key) — ไม่มี backend ไม่มี server กลาง ข้อมูลเก็บใน `localStorage` ทั้งหมด

---

## Framework ที่ใช้

| ส่วน | เทคโนโลยี |
|---|---|
| UI | React 18 + Vite 5 |
| Styling | Tailwind CSS v3 + CSS custom properties (oklch) |
| Animation | Framer Motion |
| AI / Agent | LangGraph (`@langchain/langgraph`) + `@langchain/openai` |
| IoT Protocol | MQTT over WebSocket — `mqtt.js` v5 · QoS 2 |
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
       ▼
MQTT publish → อุปกรณ์จริง / terminal agent
```

### โครงสร้างไฟล์

```
src/
├── utils/
│   ├── agent.js          # LangGraph graph + sub-agents (generateOsCommand, generateSearchQuery, detectAssistantName)
│   ├── agent_prompt.js   # System prompts ของทุก agent รวมไว้ที่เดียว
│   ├── agentSkills.js    # Tool handlers (mqtt_publish, mqtt_read, os_command, web_search)
│   ├── mqttTopic.js      # Topic normalize helpers
│   └── storage.js        # localStorage helpers
├── hooks/
│   ├── useSettings.js    # Settings + auto-detect assistant name
│   ├── useDevices.js     # Device list + MQTT sync
│   ├── useMQTT.js        # MQTT client, publish, waitForStream
│   ├── useChat.js        # Chat state + streaming
│   └── useAreas.js       # Room filter
└── components/
    ├── DeviceCard.jsx    # digital / analog / os_terminal widgets
    ├── ChatPage.jsx      # AI Chat UI
    └── SettingsPage.jsx  # 7 sections
```

### Skills (Tools ที่ AI เรียกได้)

| Skill | หน้าที่ |
|---|---|
| `mqtt_publish` | ส่ง payload ไปยัง device (digital/analog) |
| `mqtt_read` | อ่านสถานะปัจจุบันจาก device |
| `os_command` | แปลภาษา → terminal command → ส่ง MQTT ไปรันบน PC |
| `web_search` | ค้นหาผ่าน Serper API |

เพิ่ม skill ใหม่ได้ที่ Settings → Section 03 หรือเขียน handler เพิ่มใน `agentSkills.js` ตาม pattern เดิม

### MQTT Default

- Broker: `wss://broker.hivemq.com:8884/mqtt` (public, ไม่ต้อง login)
- Base Topic: `Mylab/smarthome`
- Full topic = `{Base Topic}/{suffix}` — normalize ให้อัตโนมัติ
