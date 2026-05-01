"""
SynaptaOS Hub Agent
===================
Runs on a remote computer. Connects to MQTT broker, waits for tasks,
runs CrewAI (safety check + web search + command generation),
executes the command, and streams output back line-by-line.

Ends each response with "(mqtt_end)" so the web app knows it's done.

Usage:
    python hub/agent.py

Reads config from hub/.env (copy hub/.env.example → hub/.env).
"""

import asyncio
import os
import platform
import subprocess
import sys
from datetime import datetime

import paho.mqtt.client as mqtt
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# ── Config ────────────────────────────────────────────────────────────────────

BROKER      = os.getenv("MQTT_BROKER",    "broker.hivemq.com")
PORT        = int(os.getenv("MQTT_PORT",  "1883"))
USE_TLS     = os.getenv("MQTT_USE_TLS",   "false").lower() == "true"
SUB_TOPIC   = os.getenv("MQTT_SUB_TOPIC", "hub/agent/cmd")
PUB_TOPIC   = os.getenv("MQTT_PUB_TOPIC", "hub/agent/output")
TIMEOUT     = float(os.getenv("COMMAND_TIMEOUT", "60"))

# OS_TYPE from env overrides auto-detection
_OS_MAP = {
    "Windows": "windows",
    "Darwin":  "mac",
    "Linux":   "linux",
}
OS_TYPE = os.getenv("OS_TYPE") or _OS_MAP.get(platform.system(), "linux")

# ── MQTT client (shared, thread-safe publish) ─────────────────────────────────

_client: mqtt.Client | None = None


def _publish(text: str) -> None:
    if _client:
        _client.publish(PUB_TOPIC, text, qos=1)


def _publish_lines(text: str) -> None:
    for line in text.splitlines():
        _publish(line)
    _publish("(mqtt_end)")


# ── Command execution ──────────────────────────────────────────────────────────

def _execute(command: str) -> None:
    """Run command in a subprocess, stream output line-by-line to MQTT."""
    print(f"[Hub] $ {command}")
    try:
        proc = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        for line in proc.stdout:
            stripped = line.rstrip()
            print(stripped)
            _publish(stripped)
        proc.wait()
    except Exception as e:
        _publish(f"[error] {e}")
    finally:
        _publish("(mqtt_end)")


# ── Task handler ──────────────────────────────────────────────────────────────

def _handle_task(task: str) -> None:
    """Called from MQTT on_message — runs in the MQTT network thread."""
    now = datetime.now().strftime("%A %d %B %Y %H:%M")
    print(f"\n[Hub] Task: {task}")

    # Import here so startup is fast even if CrewAI deps are slow
    try:
        from crew import run_crew
    except ImportError as e:
        _publish_lines(f"[error] Cannot import crew: {e}")
        return

    try:
        command = run_crew(task=task, os_type=OS_TYPE, now=now)
    except ValueError as e:
        _publish_lines(f"[safety] {e}")
        return
    except Exception as e:
        _publish_lines(f"[crew error] {e}")
        return

    _execute(command)


# ── MQTT callbacks ─────────────────────────────────────────────────────────────

def _on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        client.subscribe(SUB_TOPIC, qos=1)
        print(f"[Hub] Connected · listening on {SUB_TOPIC}")
    else:
        print(f"[Hub] Connect failed rc={rc}")


def _on_message(client, userdata, msg):
    task = msg.payload.decode(errors="replace").strip()
    if task:
        _handle_task(task)


def _on_disconnect(client, userdata, rc, properties=None):
    print(f"[Hub] Disconnected rc={rc} — will reconnect…")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    global _client

    print(f"SynaptaOS Hub Agent")
    print(f"  OS      : {OS_TYPE} ({platform.system()} {platform.release()})")
    print(f"  Broker  : {BROKER}:{PORT}{'  [TLS]' if USE_TLS else ''}")
    print(f"  SUB     : {SUB_TOPIC}")
    print(f"  PUB     : {PUB_TOPIC}")
    print()

    _client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    _client.on_connect    = _on_connect
    _client.on_message    = _on_message
    _client.on_disconnect = _on_disconnect

    if USE_TLS:
        import ssl
        _client.tls_set(cert_reqs=ssl.CERT_NONE)

    _client.connect(BROKER, PORT, keepalive=60)
    _client.loop_forever()


if __name__ == "__main__":
    main()
