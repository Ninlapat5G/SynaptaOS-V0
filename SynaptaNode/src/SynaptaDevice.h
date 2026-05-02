#pragma once
#include <Arduino.h>
#include <functional>
#include "SynaptaRegistry.h"

enum DeviceType { DIGITAL, ANALOG, SENSOR };

// Represents one controllable device on this ESP32.
//
// Declare globally in the sketch — the device auto-registers itself
// with SynaptaNode and its command topic is subscribed on MQTT connect.
//
// Topics are derived automatically from room + id:
//   cmd   → {baseTopic}/{room}/{id}/set
//   state → {baseTopic}/{room}/{id}/state
class SynaptaDevice {
public:
    // id   : unique device ID — must match the device ID configured in the Web App
    // room : room name (e.g. "bedroom", "living-room") — used to build the MQTT topic
    // type : DIGITAL | ANALOG | SENSOR
    SynaptaDevice(const char* id, const char* room, DeviceType type);

    // ── Command handlers ─────────────────────────────────────────────────────

    // Called when Web App sends a command. Use for custom logic.
    // DIGITAL: callback receives bool (true = on, false = off)
    void onCommand(std::function<void(bool)> cb);
    // ANALOG: callback receives int 0–255
    void onCommand(std::function<void(int)> cb);

    // Auto-control a GPIO pin with no callback needed.
    // DIGITAL: sets pin HIGH (on) or LOW (off) automatically
    void attachPin(uint8_t pin);

    // Auto-control a PWM pin with no callback needed.
    // ANALOG: writes the received value (0–255) to the pin via ledcWrite
    // Uses ESP32 Arduino 3.x ledc API (ledcAttach / ledcWrite)
    void attachPWM(uint8_t pin);

    // Attach a physical push button (active-low, internal pull-up).
    // Pressing the button toggles the device state and publishes it back
    // to the Web App — UI stays in sync with physical interactions.
    void attachButton(uint8_t pin);

    // ── Sensor reporting ─────────────────────────────────────────────────────

    // SENSOR only: call cb every <intervalMs> milliseconds.
    // cb must return a float — the library converts it to String for MQTT.
    // Example: temp.every(30000, []() { return dht.readTemperature(); });
    void every(uint32_t intervalMs, std::function<float()> cb);

    // ── Manual state control ─────────────────────────────────────────────────

    // Manually set state from code (e.g. from a rule or timer).
    // Executes GPIO/callback and publishes the new state to Web App.
    void set(bool state);   // DIGITAL
    void set(int  value);   // ANALOG

    // Read the current state value (used by RuleEngine for conditions).
    // DIGITAL → 0.0 or 1.0
    // ANALOG  → 0.0–255.0
    // SENSOR  → last reported value
    float value() const;

    // ── Internal (used by SynaptaNode & RuleEngine) ──────────────────────────

    void   _handleMessage(const char* payload);
    void   _reportState();
    void   _loop();

    String _cmdTopic  (const String& base) const;
    String _stateTopic(const String& base) const;

    const String& getId()  const { return _id; }
    DeviceType    getType() const { return _type; }

private:
    String     _id, _room;
    DeviceType _type;

    // Current state
    bool  _stateBool  = false;
    float _stateFloat = 0;

    // User callbacks
    std::function<void(bool)>  _cbDigital;
    std::function<void(int)>   _cbAnalog;
    std::function<float()>     _cbSensor;

    // Auto GPIO
    uint8_t _pin   = 255;   // 255 = not attached

    // Physical button debounce state
    uint8_t  _btnPin         = 255;
    bool     _btnLastReading = HIGH;
    bool     _btnPressed     = false;
    uint32_t _btnDebounceMs  = 0;

    // Sensor interval
    uint32_t _interval   = 0;
    uint32_t _lastReport = 0;

    // Helpers
    bool _parseBool(const char* s) const;
    int  _parseInt (const char* s) const;

    void _executeDigital(bool on);
    void _executeAnalog (int  val);
    void _publishState  ();

    // Normalise room name for use in MQTT topics:
    // "Living Room" → "living-room"
    static String _normalise(const String& s);
};
