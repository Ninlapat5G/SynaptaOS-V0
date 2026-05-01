"""
CrewAI crew for the Hub Agent.

Agents and LLM are created once at import time so they are ready
when the first task arrives. run_crew() just builds Tasks and kicks off.

  1. SafetyAgent   — decides whether the task is safe to execute.
  2. CommandAgent  — translates the task into a raw OS command,
                     optionally searches the web for syntax.

run_crew(task, os_type, now) is synchronous (blocking).
Raises ValueError if the safety agent flags the task as unsafe.
"""

import os
from datetime import datetime
from pathlib import Path

import requests
from crewai import Agent, Crew, LLM, Process, Task
from crewai.tools import BaseTool
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

# ── LLM (shared, created once) ────────────────────────────────────────────────

_llm = LLM(
    model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
    api_key=os.getenv("LLM_API_KEY", ""),
    base_url=os.getenv("LLM_BASE_URL", "https://api.openai.com/v1"),
    temperature=0,
)

# ── Web search tool ───────────────────────────────────────────────────────────

class WebSearchTool(BaseTool):
    name: str = "web_search"
    description: str = (
        "Search the web for information needed to determine the correct command syntax "
        "or verify how to perform a task on the target OS. "
        "Input: a concise search query string."
    )

    def _run(self, query: str) -> str:
        api_key = os.getenv("SERPER_API_KEY", "")
        if not api_key:
            return "web_search unavailable — SERPER_API_KEY not set"
        try:
            res = requests.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
                json={"q": query, "num": 3},
                timeout=10,
            )
            data = res.json()
            parts = []
            if data.get("answerBox", {}).get("answer"):
                parts.append(data["answerBox"]["answer"])
            elif data.get("answerBox", {}).get("snippet"):
                parts.append(data["answerBox"]["snippet"])
            for r in (data.get("organic") or [])[:3]:
                parts.append(f"{r.get('title','')}: {r.get('snippet','')}")
            return "\n".join(parts) or "No results found"
        except Exception as e:
            return f"Search error: {e}"

_search_tool = WebSearchTool()

# ── Agents (created once at startup) ─────────────────────────────────────────

_safety_agent = Agent(
    role="Security Auditor",
    goal="Decide whether a terminal task is safe to run on a user's personal computer.",
    backstory=(
        "You specialise in OS security. You flag tasks that could cause irreversible "
        "damage: deleting system files, mass deletion, credential theft, ransomware, "
        "exfiltrating data to external servers, or disabling security controls."
    ),
    llm=_llm,
    allow_delegation=False,
    verbose=False,
)

_command_agent = Agent(
    role="Command Specialist",
    goal="Translate a natural-language task into a precise terminal command.",
    backstory=(
        "You are an expert in Windows, macOS, and Linux command-line syntax. "
        "You always output ONLY the raw command — no explanation, no markdown, no backticks."
    ),
    llm=_llm,
    tools=[_search_tool],
    allow_delegation=False,
    verbose=False,
)

print("[Crew] Ready.")

# ── run_crew ──────────────────────────────────────────────────────────────────

def run_crew(task: str, os_type: str, now: str | None = None) -> str:
    """
    Returns the raw OS command string.
    Raises ValueError if the safety agent flags the task as unsafe.
    """
    if now is None:
        now = datetime.now().strftime("%A %d %B %Y %H:%M")

    safety_task = Task(
        description=(
            f"Review this terminal task: \"{task}\"\n\n"
            "Reply with exactly one of:\n"
            "  SAFE\n"
            "  UNSAFE: <one-line reason>\n"
            "No other text."
        ),
        expected_output="SAFE  or  UNSAFE: <reason>",
        agent=_safety_agent,
    )

    command_task = Task(
        description=(
            f"Target OS: {os_type}\n"
            f"Current time: {now}\n"
            f"Task: \"{task}\"\n\n"
            f"Translate the task into a single {os_type} terminal command. "
            "Use the web_search tool if you need to look up the correct syntax. "
            "Output ONLY the raw command. No markdown, no backticks, no explanation."
        ),
        expected_output=f"Single raw {os_type} terminal command",
        agent=_command_agent,
        context=[safety_task],
    )

    crew = Crew(
        agents=[_safety_agent, _command_agent],
        tasks=[safety_task, command_task],
        process=Process.sequential,
        verbose=False,
        telemetry=False,
    )

    crew.kickoff(inputs={"task": task, "os": os_type})

    safety_raw = (safety_task.output.raw or "").strip()
    if safety_raw.upper().startswith("UNSAFE"):
        reason = safety_raw.partition(":")[2].strip() or "Potentially destructive command"
        raise ValueError(f"Safety check failed: {reason}")

    command = (command_task.output.raw or "").strip()
    command = command.removeprefix("```").removesuffix("```").strip()
    for lang in ("bash\n", "cmd\n", "powershell\n", "sh\n"):
        if command.startswith(lang):
            command = command[len(lang):].strip()
            break

    return command
