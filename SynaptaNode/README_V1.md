# SynaptaNode — V1 Deferred Tasks

สิ่งที่ออกแบบไว้แล้วแต่ยังไม่ทำใน V1 นี้ เก็บไว้ทำในอนาคต

---

## Web App — สิ่งที่ต้องเพิ่ม

### บังคับ (ก่อน Dynamic Rules จะใช้งานได้จริง)

- [ ] **`agent_prompt.js`** — เพิ่ม rule JSON format และ rule topics เข้า context  
  AI จะได้รู้วิธีสร้าง/ลบ rule ผ่าน `mqtt_publish` ที่มีอยู่แล้ว

### ทางเลือก (เพิ่ม visibility ให้ AI)

- [ ] **`agentSkills.js`** — เพิ่ม skill ใหม่ชื่อ `manage_rules_node`  
  ทำ request-response กับ ESP32 เพื่ออ่าน rules ที่มีอยู่กลับมา  
  Pattern เหมือน `mqttWaitForStream` ที่ hub ใช้อยู่แล้ว

- [ ] **`data.js`** — ลงทะเบียน skill `manage_rules_node` เข้า DEFAULT_SETTINGS.skills

> สร้าง/ลบ rule ทำได้แล้วด้วย `mqtt_publish` ที่มีอยู่  
> `manage_rules_node` เพิ่มแค่ความสามารถ "อ่านกลับ" เท่านั้น

---

## Library — Feature ที่เลื่อนออกไป

- [ ] **OTA update** ผ่าน MQTT
- [ ] **Device auto-announce** — ESP32 ประกาศตัวเองให้ Web App รู้เมื่อ connect
- [ ] **AND/OR conditions** ใน Dynamic Rules (ตอนนี้รองรับแค่ condition เดียว)
- [ ] **Array of actions** ใน Dynamic Rules (ตอนนี้รองรับแค่ action เดียว)
- [ ] **Time-based conditions** เช่น `"time == 08:00"`
- [ ] **WiFi Provisioning** — เปิด hotspot ให้ตั้งค่าครั้งแรกผ่านมือถือ
