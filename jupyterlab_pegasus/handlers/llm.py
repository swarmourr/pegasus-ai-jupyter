"""
LLM handler — SSE streaming chat with multi-turn history.
Supports Anthropic, OpenAI-compatible (OpenAI, FABRIC, NRP, Ollama, custom).
Builds system prompt from: base context + skill + agent persona.
"""
import json
import asyncio
from pathlib import Path

from jupyter_server.base.handlers import JupyterHandler
from tornado.web import HTTPError

from ..config import load_config, save_config, PROVIDER_DEFAULTS
from .knowledge import get_base_context, get_skill_content, list_agents


TOOLS = [
    {
        "name": "write_file",
        "description": "Write content to a file in the user's workspace. Creates parent directories if needed.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path relative to home directory (e.g. work/rnaseq/workflow_generator.py)"},
                "content": {"type": "string", "description": "File content to write"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "read_file",
        "description": "Read a file from the user's workspace.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path relative to home directory"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "run_command",
        "description": "Run a shell command in the user's workspace. Use for pegasus-plan, pegasus-analyzer, condor_q, etc.",
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Shell command to run"},
                "cwd": {"type": "string", "description": "Working directory (default: ~/work)"},
            },
            "required": ["command"],
        },
    },
    {
        "name": "list_files",
        "description": "List files in a directory.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory path relative to home"},
            },
            "required": ["path"],
        },
    },
]


def _execute_tool(name: str, inputs: dict) -> str:
    """Execute a tool call and return result as string."""
    import subprocess
    import os

    home = Path.home()

    if name == "write_file":
        fpath = home / inputs["path"]
        fpath.parent.mkdir(parents=True, exist_ok=True)
        fpath.write_text(inputs["content"], encoding="utf-8")
        return f"Written: {fpath}"

    elif name == "read_file":
        fpath = home / inputs["path"]
        if not fpath.exists():
            return f"Error: file not found: {fpath}"
        return fpath.read_text(encoding="utf-8")

    elif name == "run_command":
        cwd = home / inputs.get("cwd", "work")
        if not cwd.exists():
            cwd = home
        try:
            result = subprocess.run(
                inputs["command"],
                shell=True,
                cwd=str(cwd),
                capture_output=True,
                text=True,
                timeout=120,
            )
            out = result.stdout or ""
            err = result.stderr or ""
            return (out + err).strip() or "(no output)"
        except subprocess.TimeoutExpired:
            return "Error: command timed out after 120s"
        except Exception as e:
            return f"Error: {e}"

    elif name == "list_files":
        dpath = home / inputs["path"]
        if not dpath.exists():
            return f"Error: directory not found: {dpath}"
        entries = []
        for entry in sorted(dpath.iterdir()):
            prefix = "d " if entry.is_dir() else "f "
            entries.append(prefix + entry.name)
        return "\n".join(entries) or "(empty)"

    return f"Unknown tool: {name}"


def _build_system_prompt(skill_id: str | None, agent_id: str | None) -> str:
    parts = []

    base = get_base_context()
    if base:
        parts.append(base)

    if agent_id:
        agents = {a["id"]: a["content"] for a in list_agents()}
        if agent_id in agents:
            parts.append(f"## Agent persona\n{agents[agent_id]}")

    if skill_id:
        try:
            skill_content = get_skill_content(skill_id)
            parts.append(f"## Active skill: {skill_id}\n{skill_content}")
        except HTTPError:
            pass

    parts.append(
        "## File access\n"
        "You have full read/write access to the user's home directory via the write_file, "
        "read_file, list_files, and run_command tools. "
        "Default workspace: ~/work/. "
        "Use run_command for pegasus-plan, pegasus-analyzer, condor_q and other CLI tools."
    )

    return "\n\n---\n\n".join(parts)


async def _stream_anthropic(handler, messages, system_prompt, model, api_key):
    """Stream using Anthropic SDK with tool use loop."""
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    anthropic_messages = list(messages)
    max_rounds = 20

    for _ in range(max_rounds):
        with client.messages.stream(
            model=model,
            max_tokens=4096,
            system=system_prompt,
            messages=anthropic_messages,
            tools=TOOLS,
        ) as stream:
            tool_calls = []
            current_tool = None
            current_input_json = ""
            text_started = False

            for event in stream:
                etype = event.type

                if etype == "content_block_start":
                    if event.content_block.type == "tool_use":
                        current_tool = {
                            "id": event.content_block.id,
                            "name": event.content_block.name,
                        }
                        current_input_json = ""
                        handler.write(f"data: {json.dumps({'type': 'tool_start', 'name': current_tool['name']})}\n\n")
                        handler.flush()
                    elif event.content_block.type == "text":
                        text_started = True

                elif etype == "content_block_delta":
                    delta = event.delta
                    if hasattr(delta, "text"):
                        handler.write(f"data: {json.dumps({'type': 'text', 'text': delta.text})}\n\n")
                        handler.flush()
                    elif hasattr(delta, "partial_json"):
                        current_input_json += delta.partial_json

                elif etype == "content_block_stop":
                    if current_tool:
                        try:
                            inputs = json.loads(current_input_json) if current_input_json else {}
                        except json.JSONDecodeError:
                            inputs = {}
                        current_tool["input"] = inputs
                        tool_calls.append(current_tool)
                        current_tool = None
                        current_input_json = ""

                elif etype == "message_stop":
                    pass

            final_message = stream.get_final_message()

            if not tool_calls or final_message.stop_reason == "end_turn":
                handler.write(f"data: {json.dumps({'type': 'done'})}\n\n")
                handler.flush()
                return

            assistant_content = []
            for block in final_message.content:
                if block.type == "text":
                    assistant_content.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    assistant_content.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })

            anthropic_messages.append({"role": "assistant", "content": assistant_content})

            tool_results = []
            for tc in tool_calls:
                result = _execute_tool(tc["name"], tc.get("input", {}))
                handler.write(f"data: {json.dumps({'type': 'tool_result', 'name': tc['name'], 'result': result[:500]})}\n\n")
                handler.flush()
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tc["id"],
                    "content": result,
                })

            anthropic_messages.append({"role": "user", "content": tool_results})

    handler.write(f"data: {json.dumps({'type': 'done'})}\n\n")
    handler.flush()


async def _stream_openai_compatible(handler, messages, system_prompt, model, api_key, base_url):
    """Stream using OpenAI-compatible API (OpenAI, FABRIC, NRP, Ollama, custom)."""
    import httpx

    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    openai_messages = [{"role": "system", "content": system_prompt}] + [
        {"role": m["role"], "content": m["content"]}
        for m in messages
        if isinstance(m.get("content"), str)
    ]

    payload = {
        "model": model,
        "messages": openai_messages,
        "stream": True,
        "max_tokens": 4096,
    }

    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream(
            "POST",
            f"{base_url.rstrip('/')}/chat/completions",
            headers=headers,
            json=payload,
        ) as resp:
            if resp.status_code != 200:
                err = await resp.aread()
                handler.write(f"data: {json.dumps({'type': 'error', 'error': err.decode()})}\n\n")
                handler.flush()
                return

            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    delta = chunk["choices"][0]["delta"]
                    if "content" in delta and delta["content"]:
                        handler.write(f"data: {json.dumps({'type': 'text', 'text': delta['content']})}\n\n")
                        handler.flush()
                except Exception:
                    pass

    handler.write(f"data: {json.dumps({'type': 'done'})}\n\n")
    handler.flush()


class LLMConfigHandler(JupyterHandler):
    """GET/POST /pegasus/llm/config"""

    async def get(self):
        cfg = load_config()
        cfg.pop("api_key", None)
        cfg["providers"] = list(PROVIDER_DEFAULTS.keys())
        self.set_header("Content-Type", "application/json")
        self.finish(json.dumps(cfg))

    async def post(self):
        body = json.loads(self.request.body)
        save_config(
            provider=body.get("provider", "anthropic"),
            model=body.get("model", ""),
            api_key=body.get("api_key", ""),
            base_url=body.get("base_url", ""),
        )
        self.set_header("Content-Type", "application/json")
        self.finish(json.dumps({"status": "saved"}))


class LLMStreamHandler(JupyterHandler):
    """
    POST /pegasus/llm/stream
    Body: { messages, skill_id, agent_id }
    Response: SSE stream of { type, text/tool_start/tool_result/done/error }
    """

    async def post(self):
        self.set_header("Content-Type", "text/event-stream")
        self.set_header("Cache-Control", "no-cache")
        self.set_header("X-Accel-Buffering", "no")

        body = json.loads(self.request.body)
        messages  = body.get("messages", [])
        skill_id  = body.get("skill_id") or None
        agent_id  = body.get("agent_id") or None

        cfg = load_config()
        provider   = cfg["provider"]
        model      = cfg["model"]
        api_key    = cfg["api_key"]
        base_url   = cfg["base_url"]

        if not api_key and provider != "ollama":
            self.write(f"data: {json.dumps({'type': 'error', 'error': 'No API key configured. Open Settings > Pegasus to configure your LLM provider.'})}\n\n")
            self.flush()
            return

        system_prompt = _build_system_prompt(skill_id, agent_id)

        try:
            if provider == "anthropic":
                await _stream_anthropic(self, messages, system_prompt, model, api_key)
            else:
                await _stream_openai_compatible(self, messages, system_prompt, model, api_key, base_url)
        except Exception as e:
            self.write(f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n")
            self.flush()
