#pragma once
#include <Arduino.h>

// A single automation rule stored on the ESP32.
// Rules are sent from the Web App as JSON via MQTT.
//
// JSON format (what the Web App sends):
// {
//   "id":        "rule-01",
//   "condition": { "device": "bedroom-temp", "op": ">", "value": 30 },
//   "action":    { "device": "bedroom-ac",   "set": true },
//   "persist":   true
// }
//
// Supported operators: >  <  >=  <=  ==  !=
// persist=true  → saved to NVRAM, survives reboot
// persist=false → RAM only, cleared on reboot
struct Rule {
    String id;

    // Condition: deviceId.value() <op> threshold
    String condDevice;
    String condOp;
    float  condValue = 0;

    // Action: set target device state
    String actDevice;
    bool   actIsBool = true;    // true = bool action, false = int action
    bool   actBool   = false;
    int    actInt    = 0;

    bool persist = false;
};
