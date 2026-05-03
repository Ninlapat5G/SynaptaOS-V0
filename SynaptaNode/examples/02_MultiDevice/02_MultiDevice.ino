/*
 * 02_MultiDevice — Multiple devices on one ESP32
 *
 * Web App setup — add each device with its matching id & room:
 *   bedroom-relay  | bedroom | digital
 *   bedroom-dimmer | bedroom | analog
 *
 * Wiring:
 *   Relay IN   → GPIO 2
 *   LED/MOSFET → GPIO 4  (PWM capable)
 */

#include <Synapta.h>

SynaptaDevice relay ("bedroom-relay",  "bedroom", NODE_DIGITAL);
SynaptaDevice dimmer("bedroom-dimmer", "bedroom", NODE_ANALOG);

void setup() {
    Serial.begin(115200);

    Synapta.begin("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD", "Mylab/smarthome");

    // Auto-control GPIO — no callback needed.
    // Web App sends "true" → HIGH, "false" → LOW
    relay.attachPin(2);

    // Auto PWM — Web App sends 0–255 → ledcWrite
    dimmer.attachPWM(4);

    // Optional: extra logic on top of attachPin/attachPWM
    relay.onCommand([](bool on) {
        if (on) {
            Serial.println("Relay: ON");
        } else {
            Serial.println("Relay: OFF");
        }
    });

    dimmer.onValue([](int val) {
        Serial.print("Dimmer: ");
        Serial.print(val);
        Serial.println("/255");
    });
}

void loop() {
    Synapta.loop();
}
