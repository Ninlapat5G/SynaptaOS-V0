/*
 * 05_DynamicRules — Rules injected from the Web App via MQTT
 * -----------------------------------------------------------
 * The Web App AI can create automation rules on this ESP32 at runtime.
 * Rules run locally — they keep working even when MQTT / internet is down.
 *
 * How it works:
 *   Web App publishes a JSON rule to:
 *     Mylab/smarthome/nodes/{nodeId}/rules/set
 *
 *   ESP32 receives it, stores it (optionally to NVRAM), and evaluates it
 *   every loop(). When condition transitions false→true, the action fires.
 *
 * Rule JSON format:
 *   {
 *     "id":        "rule-01",
 *     "condition": { "device": "bedroom-temp", "op": ">", "value": 30 },
 *     "action":    { "device": "bedroom-ac",   "set": true },
 *     "persist":   true
 *   }
 *
 * Supported operators: >  <  >=  <=  ==  !=
 * persist=true  → survives reboot (saved to NVRAM)
 * persist=false → RAM only, cleared on reboot
 *
 * Other rule topics:
 *   .../rules/delete   → payload = rule id to delete
 *   .../rules/request  → ESP32 responds with current rules on .../rules/list
 *
 * The nodeId is auto-derived from the ESP32 MAC address.
 * To find it: open Serial Monitor after Synapta.begin() — it is printed there.
 *
 * Web App setup (add both devices):
 *   bedroom-temp | bedroom | analog   (sensor — reports temperature)
 *   bedroom-ac   | bedroom | digital  (relay — controls AC)
 *
 * Wiring:
 *   DHT22 DATA → GPIO 15
 *   AC Relay IN → GPIO 2
 *
 * Requires:
 *   DHT sensor library by Adafruit
 */

#include <Synapta.h>
#include <DHT.h>

// ── Sensor setup ──────────────────────────────────────────────────────────────
DHT dht(15, DHT22);

// ── Device Declarations ───────────────────────────────────────────────────────
// Both devices must be declared so the RuleEngine can read / set their state.
SynaptaDevice temp("bedroom-temp", "bedroom", NODE_SENSOR);
SynaptaDevice ac  ("bedroom-ac",   "bedroom", NODE_DIGITAL);

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    dht.begin();

    Synapta.begin("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD", "Mylab/smarthome");

    // Report temperature every 10 s so the condition can be evaluated
    temp.every(10000, []() {
        float t = dht.readTemperature();
        Serial.println("[Sensor] Temp: " + String(t) + " °C");
        return isnan(t) ? 0.0f : t;
    });

    // AC relay on GPIO 2
    ac.attachPin(2);
    ac.onCommand([](bool on) {
        Serial.println("AC: " + String(on ? "ON" : "OFF"));
    });

    // Print the node ID so you can build the correct rule topic
    Synapta.onConnect([]() {
        Serial.println("[Synapta] Connected");
        // Send this JSON from the Web App to create the rule:
        // Topic:   Mylab/smarthome/nodes/<nodeId>/rules/set
        // Payload: {"id":"rule-01","condition":{"device":"bedroom-temp","op":">","value":30},"action":{"device":"bedroom-ac","set":true},"persist":true}
    });
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
    Synapta.loop();
}
