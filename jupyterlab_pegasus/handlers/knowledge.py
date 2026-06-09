"""
Knowledge handler — serves Pegasus skills, agents, and reference docs.
Reads from /opt/pegasus-ai/knowledge/ (studio install) or the bundled
knowledge/ folder shipped with this extension.
"""
import json
import os
from pathlib import Path

from jupyter_server.base.handlers import JupyterHandler
from tornado.web import HTTPError


def _find_knowledge_root() -> Path:
    """
    Locate the knowledge store.
    Priority:
      1. PEGASUS_KNOWLEDGE_PATH env var (explicit override)
      2. /opt/pegasus-ai/knowledge/  (pegasus-ai-studio install)
      3. Bundled knowledge/ next to this file
    """
    env_path = os.environ.get("PEGASUS_KNOWLEDGE_PATH")
    if env_path and Path(env_path).is_dir():
        return Path(env_path)

    studio_path = Path("/opt/pegasus-ai/knowledge")
    if studio_path.is_dir():
        return studio_path

    bundled = Path(__file__).parent.parent / "knowledge"
    return bundled


KNOWLEDGE_ROOT = _find_knowledge_root()


def _read_file(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def list_skills() -> list[dict]:
    skills_dir = KNOWLEDGE_ROOT / "skills"
    if not skills_dir.is_dir():
        return []
    skills = []
    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        meta_file = skill_dir / "metadata.json"
        canonical  = skill_dir / "canonical.md"
        if not canonical.exists():
            continue
        meta = {}
        if meta_file.exists():
            meta = json.loads(meta_file.read_text())
        skills.append({
            "id":           skill_dir.name,
            "name":         meta.get("name", skill_dir.name),
            "description":  meta.get("description", ""),
            "slash_command": meta.get("slash_command", f"/{skill_dir.name}"),
            "has_content":  True,
        })
    return skills


def get_skill_content(skill_id: str) -> str:
    path = KNOWLEDGE_ROOT / "skills" / skill_id / "canonical.md"
    if not path.exists():
        raise HTTPError(404, f"Skill not found: {skill_id}")
    return path.read_text(encoding="utf-8")


def list_agents() -> list[dict]:
    agents_dir = KNOWLEDGE_ROOT / "agents"
    if not agents_dir.is_dir():
        return []
    agents = []
    for f in sorted(agents_dir.glob("*.md")):
        agents.append({
            "id":      f.stem,
            "name":    f.stem.replace("-", " ").title(),
            "content": f.read_text(encoding="utf-8"),
        })
    return agents


def get_base_context() -> str:
    """Master Pegasus context — always injected into every system prompt."""
    pegasus_ai = _read_file(KNOWLEDGE_ROOT / "references" / "PEGASUS_AI.md")
    pegasus    = _read_file(KNOWLEDGE_ROOT / "references" / "PEGASUS.md")
    return "\n\n".join(filter(None, [pegasus_ai, pegasus]))


def list_examples() -> list[str]:
    examples_dir = KNOWLEDGE_ROOT / "examples"
    if not examples_dir.is_dir():
        return []
    return [f.name for f in sorted(examples_dir.glob("*.py"))]


class KnowledgeHandler(JupyterHandler):
    """GET /pegasus/knowledge/skills — list all skills and agents."""

    async def get(self):
        self.set_header("Content-Type", "application/json")
        self.finish(json.dumps({
            "skills":   list_skills(),
            "agents":   list_agents(),
            "examples": list_examples(),
            "knowledge_root": str(KNOWLEDGE_ROOT),
        }))


class SkillHandler(JupyterHandler):
    """GET /pegasus/knowledge/skills/<skill_id> — skill canonical.md content."""

    async def get(self, skill_id: str):
        self.set_header("Content-Type", "application/json")
        content = get_skill_content(skill_id)
        self.finish(json.dumps({"id": skill_id, "content": content}))
