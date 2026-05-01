"""
SynaptaOS Hub Agent
===================
Runs on a remote computer. Connects to MQTT broker, waits for tasks,
runs CrewAI (safety check + web search + command generation),
executes the command, and streams output back line-by-line.

Topic layout (auto-built from MQTT_BASE_TOPIC + AGENT_NAME):
  cmd    : {base}/hub/{AGENT_NAME}/cmd
  output : {base}/hub/{AGENT_NAME}/output
  cancel : {base}/hub/{AGENT_NAME}/cancel

Every response ends with "(mqtt_end)".
"""

import os
import platform
import subprocess
import threading
from datetime import datetime
from pathlib import Path

import paho.mqtt.client as mqtt
from dotenv import load_dotenv
from crew import run_crew

load_dotenv(Path(__file__).resolve().parent / ".env")

# ── Config ────────────────────────────────────────────────────────────────────

BROKER  = os.getenv("MQTT_BROKER",     "broker.hivemq.com")
PORT    = int(os.getenv("MQTT_PORT",   "1883"))
USE_TLS = os.getenv("MQTT_USE_TLS",    "false").lower() == "true"
BASE    = os.getenv("MQTT_BASE_TOPIC", "").rstrip("/")
AGENT   = os.getenv("AGENT_NAME",      "hub-agent")
TIMEOUT = float(os.getenv("COMMAND_TIMEOUT", "60"))

_OS_MAP = {"Windows": "windows", "Darwin": "mac", "Linux": "linux"}
OS_TYPE = os.getenv("OS_TYPE") or _OS_MAP.get(platform.system(), "linux")


def _t(suffix: str) -> str:
    return f"{BASE}/{suffix}" if BASE else suffix


CMD_TOPIC    = _t(f"hub/{AGENT}/cmd")
OUTPUT_TOPIC = _t(f"hub/{AGENT}/output")
CANCEL_TOPIC = _t(f"hub/{AGENT}/cancel")

# ── State ─────────────────────────────────────────────────────────────────────

_client:    mqtt.Client | None      = None
_proc:      subprocess.Popen | None = None
_task_lock  = threading.Lock()   # one task at a time
_proc_lock  = threading.Lock()   # protects _proc reference
_kill_event = threading.Event()  # set by _cancel, checked by _handle_task

# ── MQTT helpers ──────────────────────────────────────────────────────────────

def _pub(text: str) -> None:
    if _client:
        _client.publish(OUTPUT_TOPIC, text, qos=1)


def _end(msg: str = "") -> None:
    """Publish optional message then the end-of-stream marker."""
    if msg:
        _pub(msg)
    _pub("(mqtt_end)")


# ── Subprocess executor ────────────────────────────────────────────────────────

def _run(command: str) -> str | None:
    """
    Execute command, stream stdout line-by-line.
    Returns an error string on failure, None on success or cancel.
    Never publishes (mqtt_end) — caller owns that.
    """
    global _proc

    print(f"[Hub] $ {command}")

    try:
        with _proc_lock:
            _proc = subprocess.Popen(
                command,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )

        for line in _proc.stdout:
            if _kill_event.is_set():
                break
            stripped = line.rstrip()
            print(stripped)
            _pub(stripped)

        if _kill_event.is_set():
            return None  # caller handles the cancel message

        try:
            _proc.wait(timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            _proc.kill()
            return f"[error] Timed out after {TIMEOUT:.0f}s"

    except Exception as e:
        return f"[error] {e}"

    finally:
        with _proc_lock:
            _proc = None

    return None  # success


# ── Task handler ──────────────────────────────────────────────────────────────

def _handle_task(task: str) -> None:
    if not _task_lock.acquire(blocking=False):
        _end("[busy] Already running a task — send 'cancel' to abort.")
        return

    _kill_event.clear()

    try:
        now = datetime.now().strftime("%A %d %B %Y %H:%M")
        print(f"\n[Hub] Task: {task}")

        try:
            command = run_crew(task=task, os_type=OS_TYPE, now=now)
        except ValueError as e:
            _end(f"[safety] {e}")
            return
        except Exception as e:
            _end(f"[crew error] {e}")
            return

        if _kill_event.is_set():
            _end("[cancelled]")
            return

        err = _run(command)

        if _kill_event.is_set():
            _end("[cancelled]")
        elif err:
            _end(err)
        else:
            _pub("(mqtt_end)")

    finally:
        _task_lock.release()


# ── Cancel ─────────────────────────────────────────────────────────────────────

def _cancel() -> None:
    global _proc
    with _proc_lock:
        p = _proc
    if p:
        print("[Hub] Cancel received — killing process")
        _kill_event.set()
        p.kill()


# ── MQTT callbacks ─────────────────────────────────────────────────────────────

def _on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        client.subscribe(CMD_TOPIC,    qos=1)
        client.subscribe(CANCEL_TOPIC, qos=1)
        print(f"[Hub] Connected")
        print(f"      CMD    : {CMD_TOPIC}")
        print(f"      OUTPUT : {OUTPUT_TOPIC}")
        print(f"      CANCEL : {CANCEL_TOPIC}")
    else:
        print(f"[Hub] Connect failed rc={rc}")


def _on_message(client, userdata, msg):
    if msg.topic == CANCEL_TOPIC:
        _cancel()
        return
    payload = msg.payload.decode(errors="replace").strip()
    if payload:
        threading.Thread(target=_handle_task, args=(payload,), daemon=True).start()


def _on_disconnect(client, userdata, rc, properties=None):
    print(f"[Hub] Disconnected rc={rc} — will reconnect…")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    global _client
    print("SynaptaOS Hub Agent")
    print(f"  OS     : {OS_TYPE} ({platform.system()} {platform.release()})")
    print(f"  Broker : {BROKER}:{PORT}{'  [TLS]' if USE_TLS else ''}")
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
