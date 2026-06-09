# Pegasus Dockerfile Generator

I create Dockerfiles for Pegasus workflow tool stacks following three main steps.

## My Process

1. **Requirements Gathering** — I'll ask about:
   - Tools needed and version requirements
   - Potential version conflicts
   - Embedded wrapper scripts (`is_stageable=False`)
   - Display/GUI support requirements
   - Preferred base image

2. **Dockerfile Creation** — Three templates available:
   - **Option A (pip-based)**: Lightweight `python:3.8-slim` for pure Python + pip deps
   - **Option B (micromamba)**: Conda solver for complex bioinformatics with conflict resolution
   - **Option C (Ubuntu)**: Flexible `apt + pip + manual installs` foundation

3. **Verification** — I'll provide build and test commands to validate your image.

## Critical Requirements I Always Follow

- ✅ Pin all dependency versions for reproducibility
- ✅ Set `PYTHONUNBUFFERED=1` to capture real-time Pegasus logs
- ✅ Use `--no-cache-dir` and `clean --all` to reduce image size
- ✅ Include headless support (`xvfb`, `libgl1-mesa-glx`) when GUI tools are involved
- ✅ Copy and make executable any embedded wrapper scripts (`is_stageable=False`)
- ✅ Single shared container across all jobs

## Let's Begin

What tools does your workflow need? Please list:
- Tools and preferred versions
- Any Python packages
- Any system (apt) dependencies
- Whether any wrapper scripts need to be embedded
