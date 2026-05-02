/*
 * 03_Sensor — Periodic sensor reporting (DHT22)
 * -----------------------------------------------
 * A NODE_SENSOR device does NOT receive commands — it only publishes values.
 * The Web App AI can read the value with mqtt_read("bedroom/bedroom-temp/state").
 *
 * This example reports temperature every 30 seconds.
 * Any sensor that returns a float works: DHT22, DS18B20, analog ADC, etc.
 *
 * Web App setup:
 *   Name:     Bedroom Temperature
 *   Room:     bedroom
 *   ID:       bedroom-temp
 *   Type:     analog   (use analog so the UI shows a numeric value)
 *   subTopic: bedroom/bedroom-temp/state
 *   pubTopic: bedroom/bedroom-temp/set   (leave blank or same — not used)
 *
 * Wiring:
 *   DHT22 DATA → GPIO 15
 *
 * Requires:
 *   DHT sensor library by Adafruit (install via Library Manager)
 */

#include <Synapta.h>
#include <DHT.h>

// ── Sensor setup ─────────────────────────────────────────────────────────────
DHT dht(15, DHT22);  // DATA pin, sensor type

// ── Device Declaration ────────────────────────────────────────────────────────
// NODE_SENSOR type: subscribes to nothing, only publishes to /state
SynaptaDevice temp("bedroom-temp", "bedroom", NODE_SENSOR);

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    dht.begin();

    Synapta.begin("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD", "Mylab/smarthome");

    // Report temperature every 30 000 ms (30 s).
    // The callback must return a float — the library publishes it as a String.
    temp.every(30000, []() {
        float t = dht.readTemperature();
        if (isnan(t)) {
            Serial.println("[Sensor] DHT22 read failed");
            return 0.0f;
        }
        Serial.println("[Sensor] Temperature: " + String(t) + " °C");
        return t;
    });
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
    Synapta.loop();
}
