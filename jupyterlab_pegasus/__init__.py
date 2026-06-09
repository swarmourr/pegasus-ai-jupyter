"""JupyterLab Pegasus server extension."""
import shutil
import subprocess
from pathlib import Path

from jupyter_server.utils import url_path_join

from .handlers.knowledge import KnowledgeHandler, SkillHandler
from .handlers.llm import LLMStreamHandler, LLMConfigHandler
from .handlers.workflow import WorkflowHandler, WorkflowPlanHandler

HERE = Path(__file__).parent
OPENCODE_DATA = HERE / "opencode_data"

# Default work directory where Pegasus workflows live
WORK_DIR = Path("/home/pegasus/work")


def _deploy_opencode_config(log=None):
    """Copy bundled .opencode/ agents + config into WORK_DIR/.opencode/."""
    target = WORK_DIR / ".opencode"
    try:
        target.mkdir(parents=True, exist_ok=True)
        (target / "agents").mkdir(exist_ok=True)

        for fname in ("config.json", "package.json"):
            src = OPENCODE_DATA / fname
            dst = target / fname
            if src.exists() and not dst.exists():
                shutil.copy2(src, dst)
                if log:
                    log.info(f"Pegasus: deployed {dst}")

        for agent_file in (OPENCODE_DATA / "agents").glob("*.md"):
            dst = target / "agents" / agent_file.name
            if not dst.exists():
                shutil.copy2(agent_file, dst)
                if log:
                    log.info(f"Pegasus: deployed agent {dst}")
    except Exception as exc:
        if log:
            log.warning(f"Pegasus: could not deploy opencode config: {exc}")


def _ensure_opencode(log=None):
    """Install opencode CLI via npm if not already present."""
    if shutil.which("opencode"):
        return
    if log:
        log.info("Pegasus: opencode not found — installing via npm...")
    try:
        subprocess.run(
            ["npm", "install", "-g", "opencode-ai"],
            check=True,
            capture_output=True,
            text=True,
        )
        if log:
            log.info("Pegasus: opencode installed successfully")
    except Exception as exc:
        if log:
            log.warning(f"Pegasus: could not auto-install opencode: {exc}")
            log.warning("Pegasus: run 'npm install -g opencode-ai' manually")


def _jupyter_labextension_paths():
    return [{"src": str(HERE / "labextension"), "dest": "jupyterlab-pegasus"}]


def _jupyter_server_extension_points():
    return [{"module": "jupyterlab_pegasus"}]


def _load_jupyter_server_extension(server_app):
    """Register Pegasus handlers into jupyter_server."""
    log = server_app.log

    _deploy_opencode_config(log)
    _ensure_opencode(log)

    web_app = server_app.web_app
    base_url = web_app.settings.get("base_url", "/")

    def url(*parts):
        return url_path_join(base_url, "pegasus", *parts)

    handlers = [
        (url("knowledge/skills"),          KnowledgeHandler),
        (url("knowledge/skills/(.+)"),     SkillHandler),
        (url("llm/config"),                LLMConfigHandler),
        (url("llm/stream"),                LLMStreamHandler),
        (url("workflow/run"),              WorkflowHandler),
        (url("workflow/plan"),             WorkflowPlanHandler),
    ]

    web_app.add_handlers(".*$", handlers)
    log.info("Pegasus extension loaded — /pegasus/* ready")
