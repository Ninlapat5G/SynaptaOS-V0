#include "RuleStore.h"
#include <ArduinoJson.h>

static const char* NS  = "synapta-rules";
static const char* KEY = "rules";

void RuleStore::load() {
    _rules.clear();

    Preferences prefs;
    prefs.begin(NS, true);
    String json = prefs.getString(KEY, "[]");
    prefs.end();

    JsonDocument doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) return;

    for (JsonObject obj : doc.as<JsonArray>()) {
        Rule r;
        r.id         = obj["id"].as<String>();
        r.condDevice = obj["condDevice"].as<String>();
        r.condOp     = obj["condOp"].as<String>();
        r.condValue  = obj["condValue"] | 0.0f;
        r.actDevice  = obj["actDevice"].as<String>();
        r.actIsBool  = obj["actIsBool"] | true;
        r.actBool    = obj["actBool"]   | false;
        r.actInt     = obj["actInt"]    | 0;
        r.persist    = true;
        if (!r.id.isEmpty()) _rules.push_back(r);
    }
}

bool RuleStore::add(const Rule& r) {
    for (auto& existing : _rules) {
        if (existing.id == r.id) {
            existing = r;
            if (r.persist) _save();
            return true;
        }
    }
    if ((int)_rules.size() >= MAX_RULES) return false;
    _rules.push_back(r);
    if (r.persist) _save();
    return true;
}

bool RuleStore::remove(const String& id) {
    for (auto it = _rules.begin(); it != _rules.end(); ++it) {
        if (it->id == id) {
            bool wasPersist = it->persist;
            _rules.erase(it);
            if (wasPersist) _save();
            return true;
        }
    }
    return false;
}

String RuleStore::toJson() const {
    String out = "[";
    bool first = true;
    for (const auto& r : _rules) {
        if (!first) out += ",";
        first = false;
        out += _ruleToJson(r);
    }
    return out + "]";
}

void RuleStore::_save() const {
    String json = "[";
    bool first = true;
    for (const auto& r : _rules) {
        if (!r.persist) continue;
        if (!first) json += ",";
        first = false;
        json += _ruleToJson(r);
    }
    json += "]";

    Preferences prefs;
    prefs.begin(NS, false);
    prefs.putString(KEY, json);
    prefs.end();
}

String RuleStore::_ruleToJson(const Rule& r) {
    String s = "{";
    s += "\"id\":\""         + r.id          + "\",";
    s += "\"condDevice\":\"" + r.condDevice  + "\",";
    s += "\"condOp\":\""     + r.condOp      + "\",";
    s += "\"condValue\":"    + String(r.condValue, 4) + ",";
    s += "\"actDevice\":\""  + r.actDevice   + "\",";

    if (r.actIsBool) {
        s += "\"actIsBool\":true,";
    } else {
        s += "\"actIsBool\":false,";
    }

    if (r.actBool) {
        s += "\"actBool\":true,";
    } else {
        s += "\"actBool\":false,";
    }

    s += "\"actInt\":" + String(r.actInt) + ",";

    if (r.persist) {
        s += "\"persist\":true";
    } else {
        s += "\"persist\":false";
    }

    s += "}";
    return s;
}
