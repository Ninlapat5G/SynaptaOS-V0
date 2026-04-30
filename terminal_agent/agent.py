"""
SynaptaOS Terminal Agent
========================
Runs on a remote computer. Connects to the MCP server via WebSocket,
registers itself, receives commands, executes them, and streams
stdout/stderr back line-by-line. Sends "(mcp_end)" when done.

Usage:
    conda run -n crew-agent python terminal_agent/agent.py [agent-name] [ws://host:port]

Examples:
    python terminal_agent/agent.py office-pc ws://192.168.1.100:8001
    python terminal_agent/agent.py bedroom-rpi ws://192.168.1.100:8001

Defaults:
    agent-name : hostname of this machine
    ws url     : ws://localhost:8001
"""
import asyncio
import json
import platform
import socket
import subprocess
import sys

import websockets

DEFAULT_WS_URL = "ws://localhost:8001"

# Map Python platform names → os_type string expected by the server
_OS_MAP = {
    "Windows": "windows",
    "Darwin":  "mac",
    "Linux":   "linux",
}


async def execute(ws, command: str) -> None:
    """Run a shell command and stream every output line back to the server."""
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        async for raw_line in proc.stdout:
            line = raw_line.decode(errors="replace").rstrip()
            await ws.send(line)
        await proc.wait()
    except Exception as e:
        await ws.send(f"[error] {e}")
    finally:
        await ws.send("(mcp_end)")


async def run(agent_name: str, ws_url: str) -> None:
    os_type = _OS_MAP.get(platform.system(), "linux")
    registration = json.dumps({"name": agent_name, "os": os_type})

    print(f"[Agent] name={agent_name}  os={os_type}  server={ws_url}")

    # websockets.connect used as an async iterator auto-reconnects on disconnect
    async for ws in websockets.connect(ws_url, ping_interval=20, ping_timeout=10):
        try:
            await ws.send(registration)
            print(f"[Agent] Connected and registered.")

            async for message in ws:
                command = message.strip()
                print(f"[Agent] $ {command}")
                await execute(ws, command)

        except websockets.ConnectionClosed as e:
            print(f"[Agent] Connection closed ({e.code}), reconnecting in 5 s…")
            await asyncio.sleep(5)
        except Exception as e:
            print(f"[Agent] Error: {e}, reconnecting in 5 s…")
            await asyncio.sleep(5)


if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else socket.gethostname()
    url  = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_WS_URL
    asyncio.run(run(name, url))
