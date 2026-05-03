/*
 * 01_BasicDigital — Single digital device (relay / LED)
 *
 * Web App setup (Settings → Devices → Add):
 *   Name:  Bedroom Relay
 *   Room:  bedroom
 *   ID:    bedroom-relay   ← must match the id below
 *   Type:  digital
 *
 * Wiring:
 *   Relay IN → GPIO 2
 */

#include <Synapta.h>

SynaptaDevice relay("bedroom-relay", "bedroom", NODE_DIGITAL);

void setup() {
    Serial.begin(115200);

    Synapta.begin("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD", "Mylab/smarthome");

    relay.onCommand([](bool on) {
        if (on) {
            digitalWrite(2, HIGH);
            Serial.println("Relay ON");
        } else {
            digitalWrite(2, LOW);
            Serial.println("Relay OFF");
        }
    });
}

void loop() {
    Synapta.loop();
}
