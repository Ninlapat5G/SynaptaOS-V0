# AIoT Smart Home Dashboard

## วิธีการใช้งานและการตั้งค่า

### ติดตั้งและรัน

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build
```

### ตั้งค่าครั้งแรก

1. เปิดแอป → ไปที่หน้า **Settings**
2. ใส่ **API Endpoint**, **API Key**, **Model** ใน Section 02 Language Model
3. ไปที่หน้า **Devices** → กด **+ Add Device** เพื่อเพิ่มอุปกรณ์
4. กรอก MQTT topic ของอุปกรณ์แต่ละชิ้น
5. ไปที่หน้า **AI Chat** แล้วลองพิมพ์ เช่น _"เปิดไฟห้องนั่งเล่น"_

### LLM Provider ที่รองรับ

| Provider | Endpoint |
|---|---|
| Typhoon AI (ค่าเริ่มต้น) | `https://api.opentyphoon.ai/v1` |
| OpenAI | `https://api.openai.com/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Ollama (local) | `http://localhost:11434/v1` |

### ตั้งชื่อ Assistant อัตโนมัติ

ใส่ชื่อใน System Prompt เช่น `"ชื่อของเธอคือ Aria"` — แอปจะตรวจจับและอัปเดตชื่อในหน้าแชทให้อัตโนมัติเมื่อ System Prompt เปลี่ยน

### Terminal Agent (ควบคุม PC จริง)

```bash
# รันบนเครื่องที่ต้องการควบคุม
python terminal_agent.py office-pc
# หรือใช้ binary (Windows)
terminal_agent.exe office-pc
```

สร้าง device ประเภท `os_terminal` ในแอปแล้วชี้ pubTopic ไปที่ `/cmd` topic ของเครื่องนั้น

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
