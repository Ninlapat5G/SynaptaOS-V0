/*
 * 03_Sensor — Periodic sensor reporting (DHT22)
 *
 * NODE_SENSOR only publishes — it does not receive commands.
 * The Web App AI reads the value from the state topic.
 *
 * Web App setup:
 *   Name:  Bedroom Temperature
 *   Room:  bedroom
 *   ID:    bedroom-temp
 *   Type:  analog
 *
 * Wiring:
 *   DHT22 DATA → GPIO 15
 *
 * Requires: DHT sensor library by Adafruit (install via Library Manager)
 */

#include <Synapta.h>
#include <DHT.h>

DHT dht(15, DHT22);

SynaptaDevice temp("bedroom-temp", "bedroom", NODE_SENSOR);

void setup() {
    Serial.begin(115200);
    dht.begin();

    Synapta.begin("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD", "Mylab/smarthome");

    // Report temperature every 30 seconds
    temp.every(30000, []() {
        float t = dht.readTemperature();

        if (isnan(t)) {
            Serial.println("Sensor read failed");
            return 0.0f;
        }

        Serial.print("Temperature: ");
        Serial.print(t);
        Serial.println(" C");

        return t;
    });
}

void loop() {
    Synapta.loop();
}
