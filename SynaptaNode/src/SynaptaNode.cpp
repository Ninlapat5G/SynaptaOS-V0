#include "SynaptaNode.h"
#include "SynaptaRegistry.h"

SynaptaNodeClass Synapta;

void SynaptaNodeClass::begin(const char* ssid, const char* pass, const char* baseTopic) {
    _cfg = NodeConfig(ssid, pass, baseTopic);
    _init();
}

void SynaptaNodeClass::begin() {
    _cfg.load();
    if (!_cfg.isValid()) {
        Serial.println("[Synapta] ERROR: no saved credentials. Call configure() first.");
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

    _devices.clear();   // prevent duplicate registration if called again
    for (auto* d : _SynaptaRegistry::devices()) {
        _devices.push_back(d);
    }

    if (_cfg.mqttTLS) {
        _tlsClient.setInsecure();
        _mqtt.setClient(_tlsClient);
    } else {
        _mqtt.setClient(_plainClient);
    }
    _mqtt.setServer(_cfg.mqttBroker.c_str(), _cfg.mqttPort);
    _mqtt.setCallback(_mqttCallback);
    _mqtt.setBufferSize(1024);  // large enough for rule JSON payloads

    _connectWiFi();
}

void SynaptaNodeClass::loop() {
    if (WiFi.status() != WL_CONNECTED) {
        if (_wasConnected) {
            _wasConnected = false;
            if (_cbDisconnect) _cbDisconnect();
        }
        if (millis() - _lastReconnectMs > 5000) {
            _lastReconnectMs = millis();
            _connectWiFi();
        }
        for (auto* d : _devices) d->_loop();  // buttons still work offline
        return;
    }

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
        _wasConnected = true;
        if (_cbConnect) _cbConnect();
    }

    _mqtt.loop();
    for (auto* d : _devices) d->_loop();
}

bool SynaptaNodeClass::isConnected() {
    return _mqtt.connected();
}

bool SynaptaNodeClass::_publish(const char* topic, const char* payload, bool retain) {
    if (!_mqtt.connected()) return false;
    return _mqtt.publish(topic, (const uint8_t*)payload, strlen(payload), retain);
}

void SynaptaNodeClass::_connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;

    Serial.print("[Synapta] WiFi connecting to: ");
    Serial.print(_cfg.wifiSSID);
    WiFi.begin(_cfg.wifiSSID.c_str(), _cfg.wifiPassword.c_str());

    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
        delay(500);
        Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.print(" OK — IP: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println(" failed (will retry)");
    }
}

bool SynaptaNodeClass::_connectMQTT() {
    String clientId    = "synapta-" + _macSuffix();
    String statusTopic = _statusTopic();

    Serial.print("[Synapta] MQTT connecting as: ");
    Serial.print(clientId);

    bool ok;
    if (_cfg.mqttUser.isEmpty()) {
        ok = _mqtt.connect(clientId.c_str(), statusTopic.c_str(), 0, true, "offline");
    } else {
        ok = _mqtt.connect(clientId.c_str(),
                           _cfg.mqttUser.c_str(), _cfg.mqttPassword.c_str(),
                           statusTopic.c_str(), 0, true, "offline");
    }

    if (!ok) {
        Serial.print(" failed, rc=");
        Serial.print(_mqtt.state());
        Serial.println(" (will retry)");
        return false;
    }

    Serial.println(" OK");
    _publish(statusTopic.c_str(), "online", true);

    for (auto* d : _devices) {
        String t = d->_cmdTopic(_cfg.baseTopic);
        _mqtt.subscribe(t.c_str(), 1);
        Serial.print("[Synapta] Subscribed: ");
        Serial.println(t);
    }
    for (auto* d : _devices) d->_reportState();  // sync UI on reconnect

    return true;
}

void SynaptaNodeClass::_mqttCallback(char* topic, uint8_t* payload, unsigned int len) {
    Synapta._onMessage(topic, payload, len);
}

void SynaptaNodeClass::_onMessage(char* topic, uint8_t* payload, unsigned int len) {
    String payloadStr = String((char*)payload, len);
    String topicStr   = String(topic);

    for (auto* d : _devices) {
        if (topicStr == d->_cmdTopic(_cfg.baseTopic)) {
            d->_handleMessage(payloadStr.c_str());
            return;
        }
    }

}

String SynaptaNodeClass::_macSuffix() const {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char buf[8];
    snprintf(buf, sizeof(buf), "%02X%02X%02X", mac[3], mac[4], mac[5]);
    return String(buf);
}

String SynaptaNodeClass::_nodeId() const {
    if (_cfg.nodeId.length() > 0) {
        return _cfg.nodeId;
    }
    return "node-" + _macSuffix();
}

String SynaptaNodeClass::_statusTopic() const { return _cfg.baseTopic + "/nodes/" + _nodeId() + "/status"; }
