/*
 * 05_DynamicRules — Automation rules sent from the Web App via MQTT
 *
 * The Web App sends a rule to this ESP32 at runtime.
 * The ESP32 stores and evaluates the rule locally every loop().
 * Rules keep working even when MQTT / internet is down.
 *
 * Example rule — turn on AC when temperature exceeds 30 C:
 *   Topic:   Mylab/smarthome/nodes/<nodeId>/rules/set
 *   Payload: {
 *               "id": "rule-01",
 *               "condition": { "device": "bedroom-temp", "op": ">", "value": 30 },
 *               "action":    { "device": "bedroom-ac", "set": true },
 *               "persist": true
 *            }
 *
 * Operators: >  <  >=  <=  ==  !=
 * persist true  = saved to NVRAM, survives reboot
 * persist false = RAM only, cleared on reboot
 *
 * The nodeId is printed in Serial Monitor after connecting.
 *
 * Web App setup — add both devices:
 *   bedroom-temp | bedroom | analog   (sensor)
 *   bedroom-ac   | bedroom | digital  (relay)
 *
 * Wiring:
 *   DHT22 DATA  → GPIO 15
 *   AC Relay IN → GPIO 2
 *
 * Requires: DHT sensor library by Adafruit
 */

#include <Synapta.h>
#include <DHT.h>

DHT dht(15, DHT22);

SynaptaDevice temp("bedroom-temp", "bedroom", NODE_SENSOR);
SynaptaDevice ac  ("bedroom-ac",   "bedroom", NODE_DIGITAL);

void setup() {
    Serial.begin(115200);
    dht.begin();

    Synapta.begin("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD", "Mylab/smarthome");

    // Report temperature every 10 seconds
    temp.every(10000, []() {
        float t = dht.readTemperature();

        if (isnan(t)) {
            return 0.0f;
        }

        Serial.print("Temp: ");
        Serial.print(t);
        Serial.println(" C");

        return t;
    });

    ac.attachPin(2);

    ac.onCommand([](bool on) {
        if (on) {
            Serial.println("AC: ON");
        } else {
            Serial.println("AC: OFF");
        }
    });

    Synapta.onConnect([]() {
        Serial.println("Connected — send rules via MQTT to start automating");
    });
}

void loop() {
    Synapta.loop();
}
