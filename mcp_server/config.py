"""
Server configuration — loaded from .env or environment variables.
Copy .env.example → .env and fill in your values.
"""
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # LLM used by CrewAI agents (OpenAI-compatible)
    llm_api_key: str  = os.getenv("LLM_API_KEY", "")
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
    llm_model: str    = os.getenv("LLM_MODEL", "gpt-4o-mini")

    # Ports
    mcp_port: int     = int(os.getenv("MCP_PORT", "8000"))
    ws_port: int      = int(os.getenv("WS_PORT",  "8001"))

    # How long to wait for terminal output after sending a command (seconds)
    command_timeout: float = float(os.getenv("COMMAND_TIMEOUT", "30"))


settings = Settings()
