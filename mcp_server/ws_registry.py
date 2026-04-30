"""
WebSocket registry — tracks connected terminal agents.

Each agent registers on connect with {"name": "office-pc", "os": "windows"}.
The registry maps agent_name → { ws, os, queue }.
send_command() writes the command to the socket and collects streamed output
until the agent sends "(mcp_end)" or the timeout elapses.
"""
import asyncio
from typing import Optional


# { agent_name: {"ws": websocket, "os": str, "queue": asyncio.Queue} }
_registry: dict = {}


async def register(agent_name: str, os_type: str, ws) -> None:
    _registry[agent_name] = {
        "ws":    ws,
        "os":    os_type,
        "queue": asyncio.Queue(),
    }


def unregister(agent_name: str) -> None:
    _registry.pop(agent_name, None)


def get_os(agent_name: str) -> Optional[str]:
    entry = _registry.get(agent_name)
    return entry["os"] if entry else None


def list_agents() -> list[dict]:
    return [{"name": k, "os": v["os"]} for k, v in _registry.items()]


async def deliver_line(agent_name: str, line: str) -> None:
    """Called by ws_handler for every line received from the agent."""
    entry = _registry.get(agent_name)
    if entry:
        await entry["queue"].put(line)


async def send_command(
    agent_name: str,
    command: str,
    wait_output: bool,
    timeout: float = 30.0,
) -> str:
    entry = _registry.get(agent_name)
    if not entry:
        raise ValueError(f"Agent '{agent_name}' is not connected")

    ws    = entry["ws"]
    queue = entry["queue"]

    # Drain stale messages from a previous call
    while not queue.empty():
        queue.get_nowait()

    await ws.send(command)

    if not wait_output:
        return f"Command sent: {command}"

    chunks: list[str] = []
    timed_out = False

    try:
        async with asyncio.timeout(timeout):
            while True:
                line = await queue.get()
                if line == "(mcp_end)":
                    break
                chunks.append(line)
    except asyncio.TimeoutError:
        timed_out = True

    output = "\n".join(chunks)

    if timed_out and not chunks:
        return f"Command sent: {command}\n\n⚠️ No output received — agent may be offline"

    note = "\n\n⚠️ (mcp_end) not received — agent may have disconnected" if timed_out else ""
    return output + note if output else f"(no output){note}"
