#pragma once
#include <Arduino.h>
#include <vector>
#include <Preferences.h>
#include "Rule.h"

// Stores rules in RAM. Persistent rules (persist=true) are also
// written to NVRAM via Preferences so they survive reboots.
//
// Capacity: up to MAX_RULES rules total (RAM + NVRAM combined).
class RuleStore {
public:
    static constexpr int MAX_RULES = 20;

    // Load persistent rules from NVRAM into RAM.
    // Call once during node initialisation.
    void load();

    // Add or replace a rule (matched by id).
    // Returns false if the store is full.
    bool add(const Rule& r);

    // Remove a rule by id. Returns false if not found.
    bool remove(const String& id);

    const std::vector<Rule>& all() const { return _rules; }

    // Serialize all rules to a JSON array string (for MQTT rules/list response)
    String toJson() const;

private:
    std::vector<Rule> _rules;

    // Write all persistent rules to NVRAM
    void _save() const;

    static String _ruleToJson(const Rule& r);
};
