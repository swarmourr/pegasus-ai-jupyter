"""
Workflow handler — runs Pegasus CLI commands as the current user.
All commands run in ~/work/ by default (same user as JupyterLab process).
"""
import json
import os
import subprocess
from pathlib import Path

from jupyter_server.base.handlers import JupyterHandler


HOME = Path.home()
DEFAULT_WORK = HOME / "work"


def _run(cmd: str, cwd: Path, timeout: int = 120) -> dict:
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            cwd=str(cwd) if cwd.exists() else str(HOME),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "success": result.returncode == 0,
        }
    except subprocess.TimeoutExpired:
        return {"returncode": -1, "stdout": "", "stderr": f"Timed out after {timeout}s", "success": False}
    except Exception as e:
        return {"returncode": -1, "stdout": "", "stderr": str(e), "success": False}


class WorkflowHandler(JupyterHandler):
    """
    POST /pegasus/workflow/run
    Body: { command, cwd }
    Runs any shell command as the current user and returns stdout/stderr.
    Used by the cell for pegasus-status, condor_q, pegasus-analyzer, etc.
    """

    async def post(self):
        body = json.loads(self.request.body)
        command = body.get("command", "")
        cwd_str = body.get("cwd", str(DEFAULT_WORK))
        cwd = Path(cwd_str)

        if not command:
            self.set_status(400)
            self.finish(json.dumps({"error": "command is required"}))
            return

        result = _run(command, cwd)
        self.set_header("Content-Type", "application/json")
        self.finish(json.dumps(result))


class WorkflowPlanHandler(JupyterHandler):
    """
    POST /pegasus/workflow/plan
    Body: { workflow_file, site, output_site, submit, cwd }
    Runs pegasus-plan (and optionally --submit).
    """

    async def post(self):
        body = json.loads(self.request.body)
        workflow_file = body.get("workflow_file", "workflow.yml")
        site          = body.get("site", "local")
        output_site   = body.get("output_site", "local")
        submit        = body.get("submit", False)
        cwd_str       = body.get("cwd", str(DEFAULT_WORK))
        cwd = Path(cwd_str)

        cmd = (
            f"pegasus-plan"
            f" --sites {site}"
            f" --output-sites {output_site}"
            f" --dir {cwd}/runs"
            f"{'  --submit' if submit else ''}"
            f" {workflow_file}"
        )

        result = _run(cmd, cwd, timeout=300)
        self.set_header("Content-Type", "application/json")
        self.finish(json.dumps(result))
