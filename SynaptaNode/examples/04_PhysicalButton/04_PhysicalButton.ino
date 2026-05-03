/*
 * 04_PhysicalButton — Physical toggle button + MQTT sync
 *
 * When the button is pressed:
 *   1. Device state is toggled locally
 *   2. GPIO is updated
 *   3. New state is published → Web App UI updates
 *
 * Web App setup:
 *   Name: Bedroom Lamp   Room: bedroom   ID: bedroom-lamp   Type: digital
 *
 * Wiring:
 *   Relay IN → GPIO 2
 *   Button   → GPIO 5, other pin → GND  (internal pull-up, active-low)
 */

#include <Synapta.h>

SynaptaDevice lamp("bedroom-lamp", "bedroom", NODE_DIGITAL);

void setup() {
    Serial.begin(115200);

    Synapta.begin("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD", "Mylab/smarthome");

    lamp.attachPin(2);      // auto-drive GPIO 2
    lamp.attachButton(5);   // monitor GPIO 5 as toggle button

    lamp.onCommand([](bool on) {
        if (on) {
            Serial.println("Lamp: ON");
        } else {
            Serial.println("Lamp: OFF");
        }
    });

    Synapta.onConnect([]() {
        Serial.println("[Synapta] Connected");
    });

    Synapta.onDisconnect([]() {
        Serial.println("[Synapta] Disconnected — button still works");
    });
}

void loop() {
    Synapta.loop();
}
