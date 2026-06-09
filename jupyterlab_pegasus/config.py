"""
LLM configuration — reads from ~/.pegasus-ai/.env
(same file used by pegasus-ai-studio and pegasus-ai-workbench)
so users who already configured their LLM don't need to do it again.
"""
import os
from pathlib import Path
from dotenv import dotenv_values

ENV_FILE = Path.home() / ".pegasus-ai" / ".env"

PROVIDER_DEFAULTS = {
    "anthropic": {
        "base_url": "https://api.anthropic.com/v1",
        "model": "claude-sonnet-4-5-20250929",
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o",
    },
    "fabric": {
        "base_url": "https://ai.fabric-testbed.net/v1",
        "model": "qwen3-coder-30b",
    },
    "nrp": {
        "base_url": "https://ellm.nrp-nautilus.io/v1",
        "model": "qwen3-coder-30b",
    },
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "model": "qwen2.5-coder:7b",
    },
    "custom": {
        "base_url": "",
        "model": "",
    },
}


def load_config() -> dict:
    """Load LLM config from ~/.pegasus-ai/.env, falling back to environment."""
    cfg: dict = {}

    if ENV_FILE.exists():
        cfg = dict(dotenv_values(ENV_FILE))

    provider   = cfg.get("LLM_PROVIDER") or os.environ.get("LLM_PROVIDER", "anthropic")
    model      = cfg.get("LLM_MODEL")    or os.environ.get("LLM_MODEL", "")
    api_key    = (
        cfg.get("ANTHROPIC_API_KEY")  or os.environ.get("ANTHROPIC_API_KEY") or
        cfg.get("OPENAI_API_KEY")     or os.environ.get("OPENAI_API_KEY") or
        cfg.get("FABRIC_AI_API_KEY")  or os.environ.get("FABRIC_AI_API_KEY") or
        cfg.get("NRP_API_KEY")        or os.environ.get("NRP_API_KEY") or
        cfg.get("CUSTOM_API_KEY")     or os.environ.get("CUSTOM_API_KEY", "")
    )
    base_url   = cfg.get("CUSTOM_BASE_URL") or os.environ.get("CUSTOM_BASE_URL", "")
    ollama_host = cfg.get("OLLAMA_HOST") or os.environ.get("OLLAMA_HOST", "http://localhost:11434")

    defaults = PROVIDER_DEFAULTS.get(provider, {})
    if not model:
        model = defaults.get("model", "")
    if not base_url:
        base_url = defaults.get("base_url", "")
    if provider == "ollama":
        base_url = ollama_host + "/v1"

    return {
        "provider": provider,
        "model": model,
        "api_key": api_key,
        "base_url": base_url,
    }


def save_config(provider: str, model: str, api_key: str, base_url: str = "") -> None:
    """Persist LLM config to ~/.pegasus-ai/.env."""
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)

    key_map = {
        "anthropic": "ANTHROPIC_API_KEY",
        "openai":    "OPENAI_API_KEY",
        "fabric":    "FABRIC_AI_API_KEY",
        "nrp":       "NRP_API_KEY",
        "custom":    "CUSTOM_API_KEY",
        "ollama":    "OLLAMA_HOST",
    }
    key_name = key_map.get(provider, "CUSTOM_API_KEY")

    lines = [
        f"LLM_PROVIDER={provider}\n",
        f"LLM_MODEL={model}\n",
        f"{key_name}={api_key}\n",
    ]
    if base_url:
        lines.append(f"CUSTOM_BASE_URL={base_url}\n")

    with open(ENV_FILE, "w") as f:
        f.writelines(lines)
