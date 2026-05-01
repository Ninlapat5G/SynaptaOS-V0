import os
import subprocess
import argparse
import paho.mqtt.client as mqtt

# ── Argument Parsing ───────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Terminal Agent for MQTT Smart Home")
parser.add_argument(
    "computer_name", 
    nargs="?",               # ใส่หรือไม่ใส่ก็ได้ ถ้าไม่ใส่จะใช้ default
    default="office-pc",     # ค่าเริ่มต้นถ้าไม่ได้พิมพ์อะไรต่อท้าย
    help="Name of the computer (e.g., mylab, office-pc)"
)
args = parser.parse_args()

# ── Config ─────────────────────────────────────────────────────────────────────
BROKER        = "broker.hivemq.com"
PORT          = 8883          # TLS — encrypted
BASE          = "Mylab/smarthome"
COMPUTER_NAME = args.computer_name  # รับค่ามาจาก Command Line 

CMD_TOPIC = f"{BASE}/{COMPUTER_NAME}/cmd"
OUT_TOPIC = f"{BASE}/{COMPUTER_NAME}/output"

# ── Handlers ───────────────────────────────────────────────────────────────────

def on_connect(client, userdata, flags, rc):
    print(f"[MQTT] connected (rc={rc})")
    print(f"[MQTT] Agent Name  : {COMPUTER_NAME}")
    print(f"[MQTT] listening on  : {CMD_TOPIC}")
    print(f"[MQTT] publishing to : {OUT_TOPIC}")
    client.subscribe(CMD_TOPIC, qos=2)

def on_message(client, userdata, msg):
    command = msg.payload.decode("utf-8").strip()
    print(f"\n$ {command}")

    try:
        # cd อัพเดต working directory ของ process นี้ได้จริง
        if command.lower().startswith("cd"):
            parts = command.split(None, 1)
            path  = parts[1].strip() if len(parts) > 1 else os.path.expanduser("~")
            try:
                os.chdir(path)
                output = os.getcwd()
            except Exception as e:
                output = f"cd: {e}"
            print(output)
            client.publish(OUT_TOPIC, output, qos=2)
        else:
            proc = subprocess.Popen(
                command,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                cwd=os.getcwd(),
            )
            has_output = False
            for line in proc.stdout:
                line = line.rstrip("\n")
                print(line)
                client.publish(OUT_TOPIC, line, qos=2)
                has_output = True
            proc.wait()
            if not has_output:
                client.publish(OUT_TOPIC, "(no output)", qos=2)
    except Exception as e:
        err_msg = f"ERROR: {e}"
        print(err_msg)
        client.publish(OUT_TOPIC, err_msg, qos=2)

    client.publish(OUT_TOPIC, "(mqtt_end)", qos=2)

# ── Main ───────────────────────────────────────────────────────────────────────

client = mqtt.Client(client_id=f"aiot_{COMPUTER_NAME}", protocol=mqtt.MQTTv311)
client.on_connect = on_connect
client.on_message = on_message

print(f"[MQTT] connecting to {BROKER}:{PORT} (TLS) ...")
client.tls_set()              # ใช้ CA bundle ของระบบ — ไม่ต้อง config เพิ่ม
client.connect(BROKER, PORT, keepalive=60)
client.loop_forever()