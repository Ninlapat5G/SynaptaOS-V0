/*
 * 01_BasicDigital — Single digital device (relay / LED)
 * -------------------------------------------------------
 * The simplest possible SynaptaNode sketch.
 * The Web App AI can say "turn on the bedroom relay" and this ESP32
 * will receive "true" on MQTT and switch the GPIO accordingly.
 *
 * Web App setup (Settings → Devices → Add):
 *   Name:     Bedroom Relay
 *   Room:     bedroom
 *   ID:       bedroom-relay       ← must match SynaptaDevice id below
 *   Type:     digital
 *   pubTopic: bedroom/bedroom-relay/set
 *   subTopic: bedroom/bedroom-relay/state
 *
 * Wiring:
 *   Relay IN → GPIO 2
 */

#include <Synapta.h>

// ── Device Declaration ────────────────────────────────────────────────────────
// Declaring the device globally auto-registers it.
// When Synapta.begin() is called, it subscribes to this device's command topic.
SynaptaDevice relay("bedroom-relay", "bedroom", DIGITAL);

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);

    // Connect to WiFi + MQTT.
    // The base topic must match "Base Topic" in Web App → Settings → MQTT.
    Synapta.begin("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD", "Mylab/smarthome");

    // Define what happens when the Web App sends a command.
    // Payload "true" / "on" / "1"   → on = true
    // Payload "false" / "off" / "0" → on = false
    // Payload "toggle"              → inverts current state
    relay.onCommand([](bool on) {
        digitalWrite(2, on ? HIGH : LOW);
        Serial.println(on ? "Relay ON" : "Relay OFF");
    });
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
    // Must be called every loop — handles WiFi/MQTT reconnect,
    // sensor intervals, button debounce, and rule evaluation.
    Synapta.loop();
}
