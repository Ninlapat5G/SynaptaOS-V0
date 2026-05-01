"""
CrewAI crew for the Hub Agent.

Three agents run sequentially:
  1. SafetyAgent   — decides whether the task is safe to execute.
  2. CommandAgent  — translates the task into a raw OS command,
                     can search the web when needed.

run_crew(task, os_type, now) is synchronous (blocking).
Raises ValueError if the safety agent flags the task as unsafe.
"""

import os
import json
from datetime import datetime

import requests
from crewai import Agent, Crew, Process, Task
from crewai.tools import BaseTool
from langchain_openai import ChatOpenAI
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))


# ── LLM factory ───────────────────────────────────────────────────────────────

def _llm() -> ChatOpenAI:
    return ChatOpenAI(
        api_key=os.getenv("LLM_API_KEY", ""),
        base_url=os.getenv("LLM_BASE_URL", "https://api.openai.com/v1"),
        model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
        temperature=0,
    )


# ── Serper web search tool ────────────────────────────────────────────────────

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


# ── Crew ───────────────────────────────────────────────────────────────────────

def run_crew(task: str, os_type: str, now: str | None = None) -> str:
    """
    Run safety check + command generation.

    Returns the raw OS command string.
    Raises ValueError if the safety agent flags the task as unsafe.
    """
    if now is None:
        now = datetime.now().strftime("%A %d %B %Y %H:%M")

    llm         = _llm()
    search_tool = WebSearchTool()

    # ── Agents ────────────────────────────────────────────────────────────────

    safety_agent = Agent(
        role="Security Auditor",
        goal="Decide whether a terminal task is safe to run on a user's personal computer.",
        backstory=(
            "You specialise in OS security. You flag tasks that could cause irreversible "
            "damage: deleting system files, mass deletion, credential theft, ransomware, "
            "exfiltrating data to external servers, or disabling security controls."
        ),
        llm=llm,
        allow_delegation=False,
        verbose=False,
    )

    command_agent = Agent(
        role=f"{os_type.capitalize()} Command Specialist",
        goal=(
            f"Translate a natural-language task into a precise {os_type} terminal command. "
            "Search the web when you need to verify syntax or find the right tool."
        ),
        backstory=(
            f"You are an expert in {os_type} command-line syntax. "
            "You always output ONLY the raw command — no explanation, no markdown, no backticks. "
            f"Current date/time: {now}."
        ),
        llm=llm,
        tools=[search_tool],
        allow_delegation=False,
        verbose=False,
    )

    # ── Tasks ─────────────────────────────────────────────────────────────────

    safety_task = Task(
        description=(
            f"Review this terminal task: \"{task}\"\n\n"
            "Reply with exactly one of:\n"
            "  SAFE\n"
            "  UNSAFE: <one-line reason>\n"
            "No other text."
        ),
        expected_output="SAFE  or  UNSAFE: <reason>",
        agent=safety_agent,
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
        agent=command_agent,
        context=[safety_task],
    )

    # ── Run ───────────────────────────────────────────────────────────────────

    crew = Crew(
        agents=[safety_agent, command_agent],
        tasks=[safety_task, command_task],
        process=Process.sequential,
        verbose=False,
    )

    crew.kickoff(inputs={"task": task, "os": os_type})

    # ── Parse results ─────────────────────────────────────────────────────────

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
