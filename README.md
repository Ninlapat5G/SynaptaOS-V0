# SynaptaOS — Smart Home Dashboard

AI-powered smart home dashboard พูดภาษาไทย ควบคุมอุปกรณ์ผ่าน MQTT และสั่งงานคอมพิวเตอร์ remote ผ่าน Hub Agent (CrewAI + MQTT)

---

## วิธีการใช้งาน

### 1. ตั้งค่าครั้งแรก

ไปที่หน้า **Settings** แล้วกรอก:
- **API Endpoint** + **API Key** + **Model** (Section 02 Language Model)
- **MQTT Broker URL** (Section 05) — ค่าเริ่มต้นใช้ HiveMQ public broker ได้เลย
- **Profile** (Section 01) — แนะนำตัวกับ AI เพื่อให้ตอบกลับได้ตรงใจ เช่น `"ชื่อ Mira ชอบตอบสั้น"`

> ตั้งชื่อ Assistant ได้ใน System Prompt เช่น `"ชื่อของเธอคือ Aria"` — แอปจะตรวจจับและอัปเดตชื่อในหน้าแชทอัตโนมัติ

---

### 2. เพิ่มอุปกรณ์

ไปที่หน้า **Devices** → เลือกประเภท:

| ปุ่ม | Device Type | หน้าที่ |
|---|---|---|
| **Add Device** | digital / analog | อุปกรณ์ IoT ทั่วไป ควบคุมผ่าน MQTT |
| **Add Terminal** | os_terminal | คอมพิวเตอร์ remote — AI แปลคำสั่ง → MQTT |
| **Add Hub** | hub | คอมพิวเตอร์ remote — AI Hub Agent (CrewAI) ค้นหา + ตรวจสอบความปลอดภัย + รัน command เอง |

---

### 3. สั่งงานผ่าน AI Chat

ไปที่หน้า **AI Chat** แล้วพิมพ์หรือพูดคำสั่งได้เลย:

| ตัวอย่างคำสั่ง | ผลลัพธ์ |
|---|---|
| `เปิดไฟห้องนั่งเล่น` | เปิด device ที่กำหนด |
| `หรี่แสงลงครึ่งนึง` | คำนวณค่าแล้ว publish |
| `ปิดไฟทั้งบ้าน` | สั่งทุก device พร้อมกัน |
| `เปิดเพลง [ชื่อเพลง]` | ค้นหา YouTube แล้วเปิดทันที |
| `เช็คว่าเครื่อง office-pc มี RAM เหลือเท่าไหร่` | Hub agent ค้นหาคำสั่งที่ถูกต้องแล้วรัน |

---

### 4. Hub Agent — ติดตั้งบนเครื่อง remote

Hub Agent คือโปรแกรม Python ที่รันบนเครื่องที่ต้องการควบคุม ทำงานผ่าน MQTT เหมือนอุปกรณ์อื่นๆ

**สิ่งที่ Hub Agent ทำ:**
1. รับ task ภาษาธรรมชาติผ่าน MQTT
2. Safety Agent — ตรวจสอบว่า task ปลอดภัยมั้ย
3. Command Agent — ค้นหาและแปล task เป็น OS command ที่ถูกต้อง (auto-detect OS)
4. รัน command แล้วส่งผลกลับผ่าน MQTT

**วิธีตั้งค่า:**
1. คัดลอกไฟล์ `hub/.env.example` → `hub/.env` แล้วกรอกค่า
2. รัน: `python hub/agent.py`
3. เพิ่ม Hub device ใน Devices → **Add Hub** ให้ MQTT topics ตรงกับที่ตั้งใน `.env`

---

## Skills (Tools ที่ AI เรียกได้)

| Skill | หน้าที่ | Device Type |
|---|---|---|
| `mqtt_publish` | ส่ง payload ไปยัง device | digital / analog |
| `mqtt_read` | อ่านสถานะปัจจุบันจาก device | digital / analog |
| `os_command` | แปลภาษา → command → MQTT | os_terminal |
| `hub` | task → Hub Agent (CrewAI + web search) → output | hub |
| `web_search` | ค้นหาผ่าน Serper API | — |

ทุก skill เปิด/ปิดได้ใน **Settings → Skills**

---

## Framework ที่ใช้

| ส่วน | เทคโนโลยี |
|---|---|
| UI | React 18 + Vite 5 |
| Styling | Tailwind CSS v3 + CSS custom properties (oklch) |
| Animation | Framer Motion |
| AI / Agent | LangGraph (`@langchain/langgraph`) + `@langchain/openai` |
| IoT Protocol | MQTT over WebSocket — `mqtt.js` v5 · QoS 2 |
| Hub Agent | CrewAI (Safety + Command + Web Search) · MQTT · Python |
| Voice Input | Web Speech API (Chrome/Edge) |
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
│  [agent node]  ←──────────┐         │
│  · รู้เวลาปัจจุบัน        │  ReAct  │
│  · รู้ device list        │  loop   │
│  · เลือก tool หรือตอบตรง  │         │
│         │                 │         │
│         ▼ tool_calls?     │         │
│  [tools node] → Promise.all ────────┘
└─────────────────────────────────────┘
       │
       ├── mqtt_publish / mqtt_read → IoT Devices (MQTT)
       ├── os_command → MQTT → os_terminal device
       └── hub → MQTT → Hub Agent (Python)
                           └── CrewAI → Safety + Command + Web Search
                                   └── exec command → stream output → MQTT
```
