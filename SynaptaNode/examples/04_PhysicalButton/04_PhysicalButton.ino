/*
 * 04_PhysicalButton — Physical toggle button + MQTT sync
 * --------------------------------------------------------
 * attachButton keeps the Web App UI in sync with physical interactions.
 *
 * When the button is pressed:
 *   1. The device state is toggled locally
 *   2. GPIO is updated (if attachPin is also set)
 *   3. The new state is published to MQTT → Web App UI updates
 *
 * This means the light switch on the wall and the Web App always agree.
 *
 * Web App setup:
 *   Name: Bedroom Lamp   Room: bedroom   ID: bedroom-lamp   Type: digital
 *
 * Wiring:
 *   Relay IN  → GPIO 2
 *   Button    → GPIO 5, other pin → GND
 *   (Internal pull-up enabled — button is active-low)
 */

#include <Synapta.h>

// ── Device Declaration ────────────────────────────────────────────────────────
SynaptaDevice lamp("bedroom-lamp", "bedroom", DIGITAL);

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);

    Synapta.begin("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD", "Mylab/smarthome");

    // Auto-control GPIO 2 on Web App commands
    lamp.attachPin(2);

    // Monitor GPIO 5 as a physical toggle button.
    // 50 ms debounce is applied automatically.
    // Pressing the button toggles the state and publishes it back to MQTT.
    lamp.attachButton(5);

    // Optional: add custom logic on top
    lamp.onCommand([](bool on) {
        Serial.println("Lamp: " + String(on ? "ON" : "OFF"));
    });

    // Optional: log when connection is established
    Synapta.onConnect([]() {
        Serial.println("[Synapta] Connected — states re-synced with Web App");
    });

    Synapta.onDisconnect([]() {
        Serial.println("[Synapta] Disconnected — physical button still works");
    });
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
    // Physical button is polled here — keep loop() as fast as possible
    Synapta.loop();
}
