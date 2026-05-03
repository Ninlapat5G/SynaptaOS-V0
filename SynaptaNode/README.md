# SynaptaNode

ESP32 Arduino library for the [Synapta](https://github.com/Ninlapat5G) smart home system.

Connect an ESP32 as a **node** — it receives commands from the Synapta Web AI directly via MQTT, controls physical hardware, and reports state back.

---

## How it fits in the system

```
Web AI (browser)
     │  mqtt_publish("bedroom/bedroom-lamp/set", "true")
     ▼
MQTT Broker
     │  subscribe → set topic
     ▼
ESP32 + SynaptaNode
     │  publish("bedroom/bedroom-lamp/state", "true", retain=true)
     ▼
MQTT Broker → Web App updates UI
```

The Web AI talks directly to the ESP32. No hub required for device control.

---

## Installation

1. Install dependencies via **Arduino Library Manager**:
   - `PubSubClient` by Nick O'Leary
   - `ArduinoJson` by Benoît Blanchon

2. Copy the `SynaptaNode` folder into your Arduino `libraries/` directory.

3. In your sketch: `#include <Synapta.h>`

---

## Quick Start

```cpp
#include <Synapta.h>

SynaptaDevice relay("bedroom-relay", "bedroom", NODE_DIGITAL);

void setup() {
    Synapta.begin("MyWiFi", "MyPassword", "Mylab/smarthome");
    relay.onCommand([](bool on) { digitalWrite(2, on); });
}

void loop() {
    Synapta.loop();
}
```

Add the device in the Web App (Settings → Devices → Add):
- **pubTopic**: `bedroom/bedroom-relay/set`
- **subTopic**: `bedroom/bedroom-relay/state`

---

## API Reference

### `Synapta` (global singleton)

| Method | Description |
|--------|-------------|
| `begin(ssid, pass, baseTopic)` | Connect with hardcoded credentials |
| `begin()` | Connect using credentials saved to NVRAM via `configure()` |
| `configure(ssid, pass, baseTopic)` | Save credentials to NVRAM and connect |
| `loop()` | Must be called every `loop()` |
| `isConnected()` | Returns `true` when MQTT is connected |
| `onConnect(cb)` | Callback when MQTT connects / reconnects |
| `onDisconnect(cb)` | Callback when connection is lost |

---

### `SynaptaDevice(id, room, type)`

| Parameter | Description |
|-----------|-------------|
| `id` | Unique device ID — must match the device configured in the Web App |
| `room` | Room name, e.g. `"bedroom"` or `"living-room"` |
| `type` | `NODE_DIGITAL`, `NODE_ANALOG`, or `NODE_SENSOR` |

Topics are derived automatically:
- **cmd** → `{baseTopic}/{room}/{id}/set` — Web App publishes here
- **state** → `{baseTopic}/{room}/{id}/state` — ESP32 publishes here (retain=true)

| Method | Description |
|--------|-------------|
| `onCommand(cb)` | `NODE_DIGITAL`: `cb(bool on)` |
| `onValue(cb)` | `NODE_ANALOG`: `cb(int value)` |
| `attachPin(pin)` | NODE_DIGITAL: auto GPIO control, no callback needed |
| `attachPWM(pin)` | NODE_ANALOG: auto PWM via `ledcWrite`, no callback needed |
| `attachButton(pin)` | Physical toggle button — toggles state + publishes to MQTT |
| `every(ms, cb)` | NODE_SENSOR: call `cb()` every `ms` ms, publish returned `float` |
| `set(bool)` | NODE_DIGITAL: set state from code + publish |
| `set(int)` | NODE_ANALOG: set value from code + publish |
| `value()` | Read current state as `float` |

---

## MQTT Payload Format

### Digital commands (`/set`)
| Payload | Result |
|---------|--------|
| `true` / `on` / `ON` / `1` | ON |
| `false` / `off` / `OFF` / `0` | OFF |
| `toggle` | Invert current state |

### Analog commands (`/set`)
Integer string `"0"` – `"255"`

### State reports (`/state`, retain=true)
- **NODE_DIGITAL**: `"true"` or `"false"`
- **NODE_ANALOG**: integer string `"0"` – `"255"`
- **NODE_SENSOR**: float string e.g. `"28.50"`

---

## Web App Device Configuration

For each `SynaptaDevice` in your sketch, add a matching device in the Web App:

| Sketch | Web App pubTopic | Web App subTopic |
|--------|-----------------|-----------------|
| `SynaptaDevice("bedroom-relay", "bedroom", NODE_DIGITAL)` | `bedroom/bedroom-relay/set` | `bedroom/bedroom-relay/state` |
| `SynaptaDevice("living-dimmer", "living-room", NODE_ANALOG)` | `living-room/living-dimmer/set` | `living-room/living-dimmer/state` |
| `SynaptaDevice("bedroom-temp", "bedroom", NODE_SENSOR)` | *(leave blank)* | `bedroom/bedroom-temp/state` |

**Note:** Room names with spaces are normalised automatically: `"Living Room"` → `living-room`.

---

## Examples

| Sketch | What it shows |
|--------|---------------|
| `01_BasicDigital` | Single relay, minimal code |
| `02_MultiDevice` | Relay + PWM dimmer, `attachPin` / `attachPWM` |
| `03_Sensor` | DHT22 temperature reporting every 30 s |
| `04_PhysicalButton` | Toggle button keeps Web App UI in sync |

---

## Dependencies

| Library | Install via |
|---------|-------------|
| PubSubClient | Arduino Library Manager |
| ArduinoJson | Arduino Library Manager |
| DHT sensor library (examples only) | Arduino Library Manager |

Built-in (no install needed): `WiFi`, `WiFiClientSecure`, `Preferences`
