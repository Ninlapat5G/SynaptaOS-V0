"""
SynaptaOS MCP Server
====================
Runs two concurrent services:

  :MCP_PORT (default 8000) — FastAPI REST + FastMCP HTTP
      POST /run     → called by the SynaptaOS web app (simple JSON)
      GET  /agents  → list connected terminal agents
      POST /mcp/*   → MCP protocol endpoint (Claude Desktop, Claude Code, etc.)

  :WS_PORT  (default 8001) — asyncio WebSocket
      ws://host:8001  → terminal agents connect here on startup

Run:
    conda run -n crew-agent python mcp_server/server.py
"""
import asyncio
import json

import uvicorn
import websockets
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastmcp import FastMCP
from pydantic import BaseModel

from config import settings
from crew import run_crew
import ws_registry

# ── FastAPI app ────────────────────────────────────────────────────────────────

app = FastAPI(title="SynaptaOS MCP Server", docs_url="/docs")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # restrict to your web app URL in production
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    task: str
    agent_name: str
    wait_output: bool = True


@app.get("/agents")
async def get_agents():
    """List all currently connected terminal agents."""
    return {"agents": ws_registry.list_agents()}


@app.post("/run")
async def run_endpoint(req: RunRequest):
    """
    Execute a task on a remote terminal agent.
    Called by remoteShell.js in the web app.
    """
    os_type = ws_registry.get_os(req.agent_name)
    if os_type is None:
        return {"success": False, "error": f"Agent '{req.agent_name}' is not connected."}

    try:
        command = await asyncio.to_thread(run_crew, task=req.task, os_type=os_type)
    except ValueError as e:
        return {"success": False, "error": str(e)}

    try:
        output = await ws_registry.send_command(
            req.agent_name, command, req.wait_output, settings.command_timeout
        )
    except ValueError as e:
        return {"success": False, "error": str(e)}

    return {"success": True, "summary": f"Ran: {command}\n\n{output}"}


# ── FastMCP (MCP protocol clients: Claude Desktop, Claude Code, etc.) ─────────

mcp = FastMCP("SynaptaOS Remote Shell")


@mcp.tool(
    name="remote_shell",
    description=(
        "Execute a task on a remote terminal agent connected to this server. "
        "CrewAI translates the task to a safe OS-specific command and streams "
        "the output back. Use when a ws_terminal device is in the device list."
    ),
    timeout=90.0,
)
async def mcp_remote_shell(task: str, agent_name: str, wait_output: bool) -> str:
    os_type = ws_registry.get_os(agent_name)
    if os_type is None:
        return f"Error: Agent '{agent_name}' is not connected."

    try:
        command = await asyncio.to_thread(run_crew, task=task, os_type=os_type)
    except ValueError as e:
        return f"Error: {e}"

    try:
        output = await ws_registry.send_command(
            agent_name, command, wait_output, settings.command_timeout
        )
    except ValueError as e:
        return f"Error: {e}"

    return f"Ran: {command}\n\n{output}"


# Mount FastMCP under /mcp so MCP clients point at http://host:PORT/mcp
app.mount("/mcp", mcp.http_app())


# ── WebSocket server for terminal agents ──────────────────────────────────────

async def ws_handler(websocket):
    """
    Protocol:
      1. Agent sends JSON registration: {"name": "office-pc", "os": "windows"}
      2. Server sends commands as plain strings
      3. Agent streams stdout lines back, ends with "(mcp_end)"
    """
    agent_name = None
    try:
        raw = await asyncio.wait_for(websocket.recv(), timeout=10)
        data = json.loads(raw)
        agent_name = data["name"]
        os_type    = data["os"]

        await ws_registry.register(agent_name, os_type, websocket)
        print(f"[WS] + {agent_name} ({os_type})")

        async for line in websocket:
            await ws_registry.deliver_line(agent_name, line.strip())

    except Exception as e:
        print(f"[WS] Error ({agent_name}): {e}")
    finally:
        if agent_name:
            ws_registry.unregister(agent_name)
            print(f"[WS] - {agent_name}")


# ── Entry point ───────────────────────────────────────────────────────────────

async def main():
    ws_server = await websockets.serve(ws_handler, "0.0.0.0", settings.ws_port)

    print(f"SynaptaOS MCP Server")
    print(f"  REST / MCP  →  http://0.0.0.0:{settings.mcp_port}")
    print(f"  WebSocket   →  ws://0.0.0.0:{settings.ws_port}")
    print()

    config = uvicorn.Config(app, host="0.0.0.0", port=settings.mcp_port, log_level="warning")
    server = uvicorn.Server(config)

    async with ws_server:
        await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
