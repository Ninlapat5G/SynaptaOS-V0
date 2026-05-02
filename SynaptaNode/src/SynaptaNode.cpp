#include "SynaptaNode.h"
#include "SynaptaRegistry.h"

// ── Global singleton definition ───────────────────────────────────────────────

SynaptaNodeClass Synapta;

// ── Startup ───────────────────────────────────────────────────────────────────

void SynaptaNodeClass::begin(const char* ssid, const char* pass, const char* baseTopic) {
    _cfg = NodeConfig(ssid, pass, baseTopic);
    _init();
}

void SynaptaNodeClass::begin() {
    _cfg.load();
    if (!_cfg.isValid()) {
        Serial.println("[Synapta] ERROR: no credentials in NVRAM. Call configure() first.");
        return;
    }
    _init();
}

void SynaptaNodeClass::configure(const char* ssid, const char* pass, const char* baseTopic) {
    _cfg = NodeConfig(ssid, pass, baseTopic);
    _cfg.save();
    _init();
}

void SynaptaNodeClass::_init() {
    Serial.println("[Synapta] Initialising...");

    // Pick up every SynaptaDevice that was declared globally in the sketch
    for (auto* d : _SynaptaRegistry::devices()) {
        _register(d);
    }

    // Load persistent rules saved from a previous session
    _ruleStore.load();
    _ruleEngine.begin(&_ruleStore, _devices);

    // Configure the MQTT client
    if (_cfg.mqttTLS) {
        _tlsClient.setInsecure();   // skip cert verification for public brokers
        _mqtt.setClient(_tlsClient);
    } else {
        _mqtt.setClient(_plainClient);
    }

    _mqtt.setServer(_cfg.mqttBroker.c_str(), _cfg.mqttPort);
    _mqtt.setCallback(_mqttCallback);
    _mqtt.setBufferSize(1024);      // large enough for rule JSON payloads

    _connectWiFi();
}

// ── Main loop ─────────────────────────────────────────────────────────────────

void SynaptaNodeClass::loop() {
    // ── WiFi reconnect ────────────────────────────────────────────────────────
    if (WiFi.status() != WL_CONNECTED) {
        if (_wasConnected) {
            _wasConnected = false;
            if (_cbDisconnect) _cbDisconnect();
        }
        if (millis() - _lastReconnectMs > 5000) {
            _lastReconnectMs = millis();
            _connectWiFi();
        }
        // Still run device loop offline (physical buttons keep working)
        for (auto* d : _devices) d->_loop();
        _ruleEngine.evaluate();
        return;
    }

    // ── MQTT reconnect ────────────────────────────────────────────────────────
    if (!_mqtt.connected()) {
        if (_wasConnected) {
            _wasConnected = false;
            if (_cbDisconnect) _cbDisconnect();
        }
        if (millis() - _lastReconnectMs > 5000) {
            _lastReconnectMs = millis();
            if (_connectMQTT()) {
                _wasConnected = true;
                if (_cbConnect) _cbConnect();
            }
        }
    } else if (!_wasConnected) {
        // First time connected this session
        _wasConnected = true;
        if (_cbConnect) _cbConnect();
    }

    _mqtt.loop();

    // ── Device logic (sensor intervals, button debounce) ─────────────────────
    for (auto* d : _devices) d->_loop();

    // ── Rule evaluation (rising-edge trigger) ─────────────────────────────────
    _ruleEngine.evaluate();
}

// ── Status ────────────────────────────────────────────────────────────────────

bool SynaptaNodeClass::isConnected() const {
    return _mqtt.connected();
}

// ── Publish (called internally by SynaptaDevice) ─────────────────────────────

bool SynaptaNodeClass::_publish(const char* topic, const char* payload,
                                bool retain, uint8_t qos) {
    if (!_mqtt.connected()) return false;
    return _mqtt.publish(topic, (const uint8_t*)payload, strlen(payload), retain);
}

// ── Private: connection ───────────────────────────────────────────────────────

void SynaptaNodeClass::_connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;

    Serial.print("[Synapta] WiFi connecting to: " + _cfg.wifiSSID);
    WiFi.begin(_cfg.wifiSSID.c_str(), _cfg.wifiPassword.c_str());

    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
        delay(500);
        Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println(" OK — IP: " + WiFi.localIP().toString());
    } else {
        Serial.println(" failed (will retry)");
    }
}

bool SynaptaNodeClass::_connectMQTT() {
    String clientId = _buildClientId();
    Serial.print("[Synapta] MQTT connecting as: " + clientId);

    bool ok = _cfg.mqttUser.isEmpty()
        ? _mqtt.connect(clientId.c_str())
        : _mqtt.connect(clientId.c_str(),
                        _cfg.mqttUser.c_str(),
                        _cfg.mqttPassword.c_str());

    if (!ok) {
        Serial.println(" failed, rc=" + String(_mqtt.state()) + " (will retry)");
        return false;
    }

    Serial.println(" OK");

    // Subscribe to each device's command topic
    for (auto* d : _devices) {
        String t = d->_cmdTopic(_cfg.baseTopic);
        _mqtt.subscribe(t.c_str(), 1);
        Serial.println("[Synapta] Subscribed: " + t);
    }

    // Subscribe to node-level Dynamic Rules management topics
    _mqtt.subscribe(_rulesSetTopic().c_str(),     1);
    _mqtt.subscribe(_rulesDeleteTopic().c_str(),  1);
    _mqtt.subscribe(_rulesRequestTopic().c_str(), 1);

    // Report current state of all devices so the Web App UI is in sync
    _reReportAll();

    return true;
}

void SynaptaNodeClass::_register(SynaptaDevice* d) {
    _devices.push_back(d);
}

void SynaptaNodeClass::_reReportAll() {
    for (auto* d : _devices) {
        d->_reportState();
    }
}

// ── Private: MQTT message dispatch ───────────────────────────────────────────

// Static wrapper required by PubSubClient
void SynaptaNodeClass::_mqttCallback(char* topic, uint8_t* payload, unsigned int len) {
    Synapta._onMessage(topic, payload, len);
}

void SynaptaNodeClass::_onMessage(char* topic, uint8_t* payload, unsigned int len) {
    // Null-terminate the payload to treat it as a C-string safely
    String payloadStr = String((char*)payload).substring(0, len);
    String topicStr   = String(topic);

    // ── Device commands ───────────────────────────────────────────────────────
    for (auto* d : _devices) {
        if (topicStr == d->_cmdTopic(_cfg.baseTopic)) {
            d->_handleMessage(payloadStr.c_str());
            return;
        }
    }

    // ── Dynamic Rules management ──────────────────────────────────────────────
    if (topicStr == _rulesSetTopic()) {
        if (_ruleEngine.parseAndAdd(payloadStr.c_str())) {
            Serial.println("[Synapta] Rule added/updated");
        } else {
            Serial.println("[Synapta] Rule rejected (invalid JSON or store full)");
        }
        return;
    }
    if (topicStr == _rulesDeleteTopic()) {
        _ruleEngine.removeById(payloadStr.c_str())
            ? Serial.println("[Synapta] Rule deleted: " + payloadStr)
            : Serial.println("[Synapta] Rule not found: " + payloadStr);
        return;
    }
    if (topicStr == _rulesRequestTopic()) {
        // Web App requests the current rule list
        _publish(_rulesListTopic().c_str(), _ruleEngine.listJson().c_str(), false, 1);
        return;
    }
}

// ── Private: helpers ──────────────────────────────────────────────────────────

String SynaptaNodeClass::_buildClientId() const {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char buf[24];
    snprintf(buf, sizeof(buf), "synapta-%02X%02X%02X", mac[3], mac[4], mac[5]);
    return String(buf);
}

String SynaptaNodeClass::_nodeId() const {
    if (_cfg.nodeId.length() > 0) return _cfg.nodeId;
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char buf[16];
    snprintf(buf, sizeof(buf), "node-%02X%02X%02X", mac[3], mac[4], mac[5]);
    return String(buf);
}

String SynaptaNodeClass::_rulesSetTopic()     const { return _cfg.baseTopic + "/nodes/" + _nodeId() + "/rules/set"; }
String SynaptaNodeClass::_rulesDeleteTopic()  const { return _cfg.baseTopic + "/nodes/" + _nodeId() + "/rules/delete"; }
String SynaptaNodeClass::_rulesRequestTopic() const { return _cfg.baseTopic + "/nodes/" + _nodeId() + "/rules/request"; }
String SynaptaNodeClass::_rulesListTopic()    const { return _cfg.baseTopic + "/nodes/" + _nodeId() + "/rules/list"; }
