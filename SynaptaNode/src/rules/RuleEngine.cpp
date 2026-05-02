#include "RuleEngine.h"

// ── Init ──────────────────────────────────────────────────────────────────────

void RuleEngine::begin(RuleStore* store, std::vector<SynaptaDevice*>& devices) {
    _store   = store;
    _devices = &devices;
}

// ── Evaluate ──────────────────────────────────────────────────────────────────

// Called every loop() tick.
// Uses rising-edge detection: the action fires once when the condition
// transitions from false → true. It will not re-fire while the condition
// stays true, preventing repeated execution.
void RuleEngine::evaluate() {
    if (!_store || !_devices) return;

    for (const auto& r : _store->all()) {
        bool current = _evaluateCondition(r);
        bool last    = _getLastState(r.id);

        if (current && !last) {
            // Condition just became true — execute the action once
            _executeAction(r);
        }

        _setLastState(r.id, current);
    }
}

// ── Parse & manage ────────────────────────────────────────────────────────────

// Accepts the JSON payload from the MQTT rules/set topic.
// Expected format:
// {
//   "id":        "rule-01",
//   "condition": { "device": "bedroom-temp", "op": ">", "value": 30 },
//   "action":    { "device": "bedroom-ac",   "set": true },
//   "persist":   true
// }
bool RuleEngine::parseAndAdd(const char* json) {
    if (!_store) return false;

    JsonDocument doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) return false;

    Rule r;
    r.id         = doc["id"]                   | "";
    r.condDevice = doc["condition"]["device"]  | "";
    r.condOp     = doc["condition"]["op"]      | ">";
    r.condValue  = doc["condition"]["value"]   | 0.0f;
    r.actDevice  = doc["action"]["device"]     | "";
    r.persist    = doc["persist"]              | false;

    if (r.id.length() == 0 || r.condDevice.length() == 0 || r.actDevice.length() == 0)
        return false;

    // The "set" value in action can be bool or int
    JsonVariant setVal = doc["action"]["set"];
    if (setVal.is<bool>()) {
        r.actIsBool = true;
        r.actBool   = setVal.as<bool>();
    } else {
        r.actIsBool = false;
        r.actInt    = setVal.as<int>();
    }

    return _store->add(r);
}

bool RuleEngine::removeById(const char* id) {
    if (!_store) return false;
    return _store->remove(String(id));
}

String RuleEngine::listJson() const {
    if (!_store) return "[]";
    return _store->toJson();
}

// ── Private ───────────────────────────────────────────────────────────────────

bool RuleEngine::_evaluateCondition(const Rule& r) const {
    float val = _getDeviceValue(r.condDevice);
    if (isnan(val)) return false;
    return _compare(val, r.condOp, r.condValue);
}

void RuleEngine::_executeAction(const Rule& r) {
    if (!_devices) return;
    for (auto* d : *_devices) {
        if (d->getId() == r.actDevice) {
            if (r.actIsBool) d->set(r.actBool);
            else             d->set(r.actInt);
            return;
        }
    }
    Serial.println("[Synapta] Rule action target not found: " + r.actDevice);
}

float RuleEngine::_getDeviceValue(const String& deviceId) const {
    if (!_devices) return NAN;
    for (auto* d : *_devices) {
        if (d->getId() == deviceId) return d->value();
    }
    return NAN;
}

bool RuleEngine::_compare(float actual, const String& op, float threshold) const {
    if (op == ">")  return actual >  threshold;
    if (op == "<")  return actual <  threshold;
    if (op == ">=") return actual >= threshold;
    if (op == "<=") return actual <= threshold;
    if (op == "==") return actual == threshold;
    if (op == "!=") return actual != threshold;
    return false;
}

bool RuleEngine::_getLastState(const String& id) const {
    for (size_t i = 0; i < _stateIds.size(); i++) {
        if (_stateIds[i] == id) return _stateVals[i];
    }
    return false;
}

void RuleEngine::_setLastState(const String& id, bool val) {
    for (size_t i = 0; i < _stateIds.size(); i++) {
        if (_stateIds[i] == id) { _stateVals[i] = val; return; }
    }
    _stateIds.push_back(id);
    _stateVals.push_back(val);
}
