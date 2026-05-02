#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <vector>
#include <functional>
#include "NodeConfig.h"
#include "SynaptaDevice.h"
#include "rules/RuleStore.h"
#include "rules/RuleEngine.h"

// Core node class — manages WiFi, MQTT, device dispatch, and rule evaluation.
//
// Access via the global singleton: Synapta
// (defined at the bottom of SynaptaNode.cpp)
class SynaptaNodeClass {
public:
    // ── Startup ──────────────────────────────────────────────────────────────

    // Connect using hardcoded credentials (good for development)
    void begin(const char* ssid, const char* pass, const char* baseTopic);

    // Connect using credentials previously saved to NVRAM via configure()
    void begin();

    // Save credentials to NVRAM and connect
    void configure(const char* ssid, const char* pass, const char* baseTopic);

    // ── Main loop ────────────────────────────────────────────────────────────

    // Must be called every loop(). Handles WiFi/MQTT reconnect,
    // device logic (sensor intervals, button debounce), and rule evaluation.
    void loop();

    // ── Status ───────────────────────────────────────────────────────────────

    bool isConnected() const;

    // ── Lifecycle callbacks ──────────────────────────────────────────────────

    // Fires when MQTT connection is (re-)established.
    // Useful for logging or triggering a status LED.
    void onConnect   (std::function<void()> cb) { _cbConnect    = cb; }

    // Fires when connection is lost.
    void onDisconnect(std::function<void()> cb) { _cbDisconnect = cb; }

    // ── Internal (used by SynaptaDevice to publish state) ────────────────────

    bool _publish(const char* topic, const char* payload,
                  bool retain = true, uint8_t qos = 1);

    const NodeConfig& config() const { return _cfg; }

private:
    NodeConfig       _cfg;
    WiFiClientSecure _tlsClient;
    WiFiClient       _plainClient;
    PubSubClient     _mqtt;

    std::vector<SynaptaDevice*> _devices;
    RuleStore  _ruleStore;
    RuleEngine _ruleEngine;

    std::function<void()> _cbConnect;
    std::function<void()> _cbDisconnect;

    bool     _wasConnected   = false;
    uint32_t _lastReconnectMs = 0;

    // Initialise clients, pick up registered devices, load rules
    void _init();

    void _connectWiFi();
    bool _connectMQTT();

    // Register a device and link it back to this node
    void _register(SynaptaDevice* d);

    // Publish current state of every device after reconnect
    void _reReportAll();

    // Derive a unique MQTT client ID from the device MAC address
    String _buildClientId() const;

    // Derive the node ID used in Dynamic Rules MQTT topics
    String _nodeId() const;

    // Rules MQTT topics (node-level, not per-device)
    String _rulesSetTopic()     const;   // .../rules/set
    String _rulesDeleteTopic()  const;   // .../rules/delete
    String _rulesRequestTopic() const;   // .../rules/request
    String _rulesListTopic()    const;   // .../rules/list

    // PubSubClient requires a static callback — delegates to the singleton
    static void _mqttCallback(char* topic, uint8_t* payload, unsigned int len);
    void _onMessage(char* topic, uint8_t* payload, unsigned int len);
};

// Global singleton — use like Serial
extern SynaptaNodeClass Synapta;
