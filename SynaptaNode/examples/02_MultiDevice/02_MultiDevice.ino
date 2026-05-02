/*
 * 02_MultiDevice — Multiple devices on one ESP32
 * ------------------------------------------------
 * One ESP32 can handle many devices at once.
 * Each SynaptaDevice declares itself globally and auto-registers.
 *
 * This example shows:
 *   - A digital relay (on/off)
 *   - An analog PWM dimmer (0–255)
 *   - attachPin  / attachPWM  for zero-callback GPIO control
 *
 * Web App setup — add each device with its matching id & room:
 *   bedroom-relay  | bedroom | digital
 *   bedroom-dimmer | bedroom | analog
 *
 * Wiring:
 *   Relay IN  → GPIO 2
 *   LED/MOSFET → GPIO 4  (PWM capable)
 */

#include <Synapta.h>

// ── Device Declarations ───────────────────────────────────────────────────────
SynaptaDevice relay ("bedroom-relay",  "bedroom", DIGITAL);
SynaptaDevice dimmer("bedroom-dimmer", "bedroom", ANALOG);

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);

    Synapta.begin("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD", "Mylab/smarthome");

    // attachPin: GPIO is controlled automatically — no callback needed.
    // When Web App sends "true", GPIO goes HIGH. "false" → LOW.
    relay.attachPin(2);

    // attachPWM: PWM value is written automatically via ledcWrite.
    // When Web App sends "128", the pin outputs ~50% duty cycle.
    dimmer.attachPWM(4);

    // You can still add onCommand on top of attachPin/attachPWM
    // if you need extra logic (e.g. logging, triggering other actions).
    relay.onCommand([](bool on) {
        Serial.println("Relay: " + String(on ? "ON" : "OFF"));
    });

    dimmer.onCommand([](int val) {
        Serial.println("Dimmer: " + String(val) + "/255");
    });
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
    Synapta.loop();
}
