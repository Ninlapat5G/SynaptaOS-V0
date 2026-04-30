"""
CrewAI crew for remote_shell.

Two agents run sequentially:
  1. SafetyAgent  — decides whether the task is safe to execute.
  2. CommandAgent — translates the task into a raw OS command.

run_crew(task, os_type) is synchronous (blocking) and is called via
asyncio.to_thread() from the async server so it never blocks the event loop.
"""
from crewai import Agent, Crew, Process, Task
from langchain_openai import ChatOpenAI

from config import settings


def _llm() -> ChatOpenAI:
    """Build a LangChain LLM from config — used by all CrewAI agents."""
    return ChatOpenAI(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        temperature=0,
    )


def run_crew(task: str, os_type: str) -> str:
    """
    Run the safety + command-generation crew.

    Returns the raw OS command string.
    Raises ValueError if the safety agent flags the task as unsafe.
    """
    llm = _llm()

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
        goal=f"Translate a natural-language task into a precise {os_type} terminal command.",
        backstory=(
            f"You are an expert in {os_type} command-line syntax. "
            "You output ONLY the raw command — no explanation, no markdown, no backticks."
        ),
        llm=llm,
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
            f"Task: \"{task}\"\n\n"
            f"Translate the task into a single {os_type} terminal command. "
            "Output ONLY the raw command. No markdown, no backticks, no explanation."
        ),
        expected_output=f"Single raw {os_type} terminal command",
        agent=command_agent,
        context=[safety_task],   # gives CommandAgent visibility of the safety verdict
    )

    # ── Crew ──────────────────────────────────────────────────────────────────

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
    # Strip any accidental markdown fences
    command = command.removeprefix("```").removesuffix("```").strip()
    for lang in ("bash\n", "cmd\n", "powershell\n", "sh\n"):
        if command.startswith(lang):
            command = command[len(lang):].strip()
            break

    return command
