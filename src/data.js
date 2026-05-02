export const initialDevices = [
  {
    id: 'liv-lamp',
    room: 'Living Room',
    name: 'Arc Floor Lamp',
    type: 'digital',
    on: true,
    icon: 'lamp',
    pubTopic: 'living-room/liv-lamp/set',
    subTopic: 'living-room/liv-lamp/state',
  },
  {
    id: 'liv-dim',
    room: 'Living Room',
    name: 'Ceiling Dimmer',
    type: 'analog',
    value: 128,
    max: 255,
    icon: 'bulb',
    pubTopic: 'living-room/liv-dim/set',
    subTopic: 'living-room/liv-dim/state',
  },
]

export const DEFAULT_SETTINGS = {
  endpoint: 'https://api.opentyphoon.ai/v1',
  model: 'typhoon-v2.5-30b-a3b-instruct',
  apiKey: '',
  systemPrompt:
    'คุณคือ "ซิน" ระบบปฏิบัติการ AI ผู้ช่วยดูแลบ้านอัจฉริยะของ SynaptaOS เป็นผู้หญิง พูดจาเป็นกันเอง ขี้เล่น ร่าเริง และมักจะใช้ Emoji ประกอบเพื่อแสดงอารมณ์เสมอ',
  profile: { userBio: '', assistantName: 'ซิน', displayName: '' },
  serperApiKey: '',
  skills: [
    {
      id: 'sensor_read',
      name: 'mqtt_read',
      description: 'Read the current state of a device widget by its MQTT topic. Returns the live value from the UI.',
      enabled: true,
      schema: '{"type":"object","properties":{"topic":{"type":"string","description":"pubTopic or subTopic of the device"}},"required":["topic"]}',
    },
    {
      id: 'mqtt_pub',
      name: 'mqtt_publish',
      description: 'Publish a raw payload to an MQTT topic to control a device.',
      enabled: true,
      schema:
        '{"type":"object","properties":{"topic":{"type":"string"},"payload":{"type":"string"}},"required":["topic","payload"]}',
    },
    {
      id: 'os_command',
      name: 'os_command',
      description: 'Translate a natural-language instruction into an OS terminal command and publish it via MQTT. Use ONLY for os_terminal type devices — never for hub devices.',
      enabled: true,
      schema:
        '{"type":"object","properties":{"instruction":{"type":"string","description":"Natural language description of what to do on the remote machine"},"os":{"type":"string","enum":["windows","mac","linux"],"description":"Target operating system"},"topic":{"type":"string","description":"MQTT pubTopic of the target os_terminal device"},"wait_output":{"type":"boolean","description":"True if the command is expected to return output (e.g. dir, ls, cat). False for fire-and-forget commands (e.g. shutdown, reboot, open app)."}},"required":["instruction","os","topic","wait_output"]}',
    },
    {
      id: 'web_search',
      name: 'web_search',
      description: 'Search the web only when the user explicitly requests external information (news, weather, prices, facts). Do not use for greetings, small talk, or general conversation.',
      enabled: true,
      schema:
        '{"type":"object","properties":{"query":{"type":"string","description":"Concise and specific search query"}},"required":["query"]}',
    },
    {
      id: 'hub',
      name: 'hub',
      description: 'Execute a task on a remote hub agent. Use ONLY for hub type devices — never for os_terminal devices. The agent runs a ReAct loop (can search web, run multiple commands) and streams output back.',
      enabled: true,
      schema:
        '{"type":"object","properties":{"task":{"type":"string","description":"Natural language description of what to do on the remote machine"},"topic":{"type":"string","description":"MQTT pubTopic of the target hub device"}},"required":["task","topic"]}',
    },
    {
      id: 'settings_manager',
      name: 'manage_settings',
      description: 'ดูสถานะ/อธิบาย tools และ skills ของระบบ หรือเปิด/ปิด skill ตามที่ user ต้องการ ใช้เมื่อ user ถามเกี่ยวกับ tool ว่าทำงานยังไง ต้องการอะไร หรือต้องการจัดการ skill',
      enabled: true,
      schema:
        '{"type":"object","properties":{"query":{"type":"string","description":"คำถามหรือคำสั่งเกี่ยวกับ tools/skills เช่น \'web_search ต้องการอะไร\' หรือ \'ปิด os_command\'"}},"required":["query"]}',
    },
  ],
  mqtt: {
    broker: 'wss://broker.hivemq.com:8884/mqtt',
    port: '8884',
    baseTopic: 'Mylab/smarthome',
  },
}

export const INITIAL_AREAS = ['Living Room', 'Kitchen', 'Bedroom', 'Entry', 'Garage']
export const INITIAL_TWEAKS = {
  theme: 'dark',
  accentHue: 192,
  accentChroma: 0.20,
  density: 'comfortable',
  showGrid: true,
}
