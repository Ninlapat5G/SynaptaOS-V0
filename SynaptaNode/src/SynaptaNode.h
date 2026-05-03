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

class SynaptaNodeClass {
public:
    void begin(const char* ssid, const char* pass, const char* baseTopic);
    void begin();
    void configure(const char* ssid, const char* pass, const char* baseTopic);

    void loop();
    bool isConnected();

    void onConnect   (std::function<void()> cb) { _cbConnect    = cb; }
    void onDisconnect(std::function<void()> cb) { _cbDisconnect = cb; }

    bool _publish(const char* topic, const char* payload, bool retain = true);
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

    bool     _wasConnected    = false;
    uint32_t _lastReconnectMs = 0;

    void _init();
    void _connectWiFi();
    bool _connectMQTT();

    String _macSuffix()        const;
    String _nodeId()           const;
    String _statusTopic()      const;
    String _rulesSetTopic()    const;
    String _rulesDeleteTopic() const;
    String _rulesRequestTopic() const;
    String _rulesListTopic()   const;

    // PubSubClient requires a static callback
    static void _mqttCallback(char* topic, uint8_t* payload, unsigned int len);
    void _onMessage(char* topic, uint8_t* payload, unsigned int len);
};

extern SynaptaNodeClass Synapta;
