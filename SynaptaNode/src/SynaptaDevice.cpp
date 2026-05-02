#include "SynaptaDevice.h"
#include "SynaptaNode.h"   // for Synapta._publish() and config().baseTopic

// ── Constructor ───────────────────────────────────────────────────────────────

SynaptaDevice::SynaptaDevice(const char* id, const char* room, DeviceType type)
    : _id(id), _room(room), _type(type)
{
    // Auto-register into the global registry so SynaptaNode picks it up
    // during begin() without the user needing to call node.add().
    _SynaptaRegistry::devices().push_back(this);
}

// ── Command handlers ──────────────────────────────────────────────────────────

void SynaptaDevice::onCommand(std::function<void(bool)> cb) { _cbDigital = cb; }
void SynaptaDevice::onCommand(std::function<void(int)>  cb) { _cbAnalog  = cb; }

void SynaptaDevice::attachPin(uint8_t pin) {
    _pin = pin;
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
}

void SynaptaDevice::attachPWM(uint8_t pin) {
    _pin = pin;
    // ESP32 Arduino 3.x ledc API: ledcAttach(pin, freq, resolution)
    // freq=5000 Hz, 8-bit resolution → values 0–255
    ledcAttach(pin, 5000, 8);
    ledcWrite(pin, 0);
}

void SynaptaDevice::attachButton(uint8_t pin) {
    _btnPin = pin;
    pinMode(pin, INPUT_PULLUP);  // active-low button
}

void SynaptaDevice::every(uint32_t intervalMs, std::function<float()> cb) {
    _interval = intervalMs;
    _cbSensor = cb;
}

// ── Manual state control ──────────────────────────────────────────────────────

void SynaptaDevice::set(bool state) {
    _executeDigital(state);
    _publishState();
}

void SynaptaDevice::set(int value) {
    _executeAnalog(value);
    _publishState();
}

float SynaptaDevice::value() const {
    if (_type == NODE_DIGITAL) return _stateBool ? 1.0f : 0.0f;
    return _stateFloat;
}

// ── Internal: called by SynaptaNode on incoming MQTT message ─────────────────

void SynaptaDevice::_handleMessage(const char* payload) {
    if (_type == NODE_DIGITAL) {
        bool on = _parseBool(payload);
        _executeDigital(on);
        _publishState();
    } else if (_type == NODE_ANALOG) {
        int val = constrain(_parseInt(payload), 0, 255);
        _executeAnalog(val);
        _publishState();
    }
    // NODE_SENSOR ignores commands — it only publishes, never receives
}

// Publish current state to the MQTT state topic (called after reconnect)
void SynaptaDevice::_reportState() {
    _publishState();
}

// ── Internal: called by SynaptaNode::loop() each iteration ───────────────────

void SynaptaDevice::_loop() {
    // ── Sensor interval reporting ─────────────────────────────────────────────
    if (_type == NODE_SENSOR && _cbSensor && _interval > 0) {
        if (millis() - _lastReport >= _interval) {
            _lastReport = millis();
            _stateFloat = _cbSensor();
            _publishState();
        }
    }

    // ── Physical button with 50 ms debounce ───────────────────────────────────
    if (_btnPin != 255) {
        bool reading = (digitalRead(_btnPin) == LOW);  // active-low

        if (reading != _btnLastReading) {
            _btnDebounceMs = millis();           // restart debounce timer
        }

        if (millis() - _btnDebounceMs > 50) {   // stable for 50 ms
            if (reading != _btnPressed) {
                _btnPressed = reading;
                if (_btnPressed) {              // button just pressed
                    _stateBool = !_stateBool;   // toggle
                    _executeDigital(_stateBool);
                    _publishState();
                }
            }
        }

        _btnLastReading = reading;
    }
}

// ── Topic builders ────────────────────────────────────────────────────────────

// cmd   topic: {base}/{room}/{id}/set   ← Web App publishes here
// state topic: {base}/{room}/{id}/state ← ESP32 publishes here

String SynaptaDevice::_cmdTopic(const String& base) const {
    return base + "/" + _normalise(_room) + "/" + _id + "/set";
}

String SynaptaDevice::_stateTopic(const String& base) const {
    return base + "/" + _normalise(_room) + "/" + _id + "/state";
}

// ── Private helpers ───────────────────────────────────────────────────────────

void SynaptaDevice::_executeDigital(bool on) {
    _stateBool = on;
    if (_pin != 255) digitalWrite(_pin, on ? HIGH : LOW);
    if (_cbDigital)  _cbDigital(on);
}

void SynaptaDevice::_executeAnalog(int val) {
    _stateFloat = val;
    if (_pin != 255) ledcWrite(_pin, val);
    if (_cbAnalog)   _cbAnalog(val);
}

void SynaptaDevice::_publishState() {
    const String& base = Synapta.config().baseTopic;
    String topic = _stateTopic(base);
    String payload;

    if (_type == NODE_DIGITAL) {
        payload = _stateBool ? "true" : "false";
    } else if (_type == NODE_ANALOG) {
        payload = String((int)_stateFloat);
    } else {  // NODE_SENSOR
        payload = String(_stateFloat, 2);  // 2 decimal places
    }

    // retain=true: Web App receives the current state immediately on connect,
    // even if the ESP32 has not sent a new message since.
    Synapta._publish(topic.c_str(), payload.c_str(), true, 1);
}

bool SynaptaDevice::_parseBool(const char* s) const {
    String str(s);
    str.trim();
    if (str.equalsIgnoreCase("toggle")) return !_stateBool;
    return str.equalsIgnoreCase("true") ||
           str.equalsIgnoreCase("on")   ||
           str == "1";
}

int SynaptaDevice::_parseInt(const char* s) const {
    return String(s).toInt();
}

String SynaptaDevice::_normalise(const String& s) {
    String out = s;
    out.toLowerCase();
    out.replace(" ", "-");
    return out;
}
