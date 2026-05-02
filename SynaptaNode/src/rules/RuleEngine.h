#pragma once
#include <Arduino.h>
#include <vector>
#include <ArduinoJson.h>
#include "Rule.h"
#include "RuleStore.h"
#include "../SynaptaDevice.h"

// Evaluates stored rules on every loop() tick and executes actions
// when a condition transitions from false → true (rising-edge trigger).
//
// Rules are injected from the Web App via MQTT:
//   {base}/nodes/{nodeId}/rules/set     → parseAndAdd(json)
//   {base}/nodes/{nodeId}/rules/delete  → removeById(id)
//   {base}/nodes/{nodeId}/rules/request → listJson() published back
class RuleEngine {
public:
    // Must be called once with a pointer to the rule store and device list.
    void begin(RuleStore* store, std::vector<SynaptaDevice*>& devices);

    // Evaluate all rules. Call from SynaptaNode::loop().
    void evaluate();

    // Parse a JSON string from MQTT rules/set topic and add the rule.
    // Returns false if the JSON is invalid or the store is full.
    bool parseAndAdd(const char* json);

    // Remove a rule by id. Returns false if not found.
    bool removeById(const char* id);

    // Serialize all rules to JSON (response for rules/request topic).
    String listJson() const;

private:
    RuleStore*                   _store   = nullptr;
    std::vector<SynaptaDevice*>* _devices = nullptr;

    // Tracks the last evaluation result per rule id for edge detection.
    // Stored as parallel vectors to avoid std::map String-key issues.
    std::vector<String> _stateIds;
    std::vector<bool>   _stateVals;

    bool  _getLastState(const String& id) const;
    void  _setLastState(const String& id, bool val);

    float _getDeviceValue(const String& deviceId) const;
    bool  _evaluateCondition(const Rule& r) const;
    void  _executeAction   (const Rule& r);
    bool  _compare(float actual, const String& op, float threshold) const;
};
