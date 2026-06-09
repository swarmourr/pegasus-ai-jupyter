# Skill: scaffold

Generate a complete Pegasus workflow from scratch based on the user's description.

## What to produce

1. `workflow_generator.py` — full Python script using the Pegasus Python API
2. `bin/<step>.sh` — wrapper scripts for each job step
3. `Dockerfile` — container definition (use `python:3.11-slim` as base unless specified)
4. `README.md` — brief usage instructions

## Steps

1. Understand the user's scientific domain and data processing steps
2. Identify inputs, outputs, and dependencies between steps
3. Choose appropriate container images for each transformation
4. Generate the workflow Python script with proper error handling
5. Write wrapper scripts for each step
6. Write all files to `~/work/<workflow-name>/`
7. Confirm what was written and suggest the next step (run plan)

## Output format

After writing files, always show:
- A summary of the DAG (N jobs, M stages)
- The exact `pegasus-plan` command to run next
- Any assumptions made about the execution environment
