# jupyterlab-pegasus

An interactive Pegasus WMS cell for JupyterLab.

## Development install

```bash
# 1. Clone and enter the project
cd jupyterlab-pegasus

# 2. Run the install script (handles correct order)
chmod +x install.sh
./install.sh

# 3. In terminal 1 — watch TypeScript for changes
npm run watch:src

# 4. In terminal 2 — launch JupyterLab
jupyter lab
```

**Or manually, step by step:**

```bash
# Python backend (no npm needed)
pip install -e "." --no-build-isolation

# Frontend
npm install
npm run build:lib
jupyter labextension build .
jupyter labextension develop --overwrite .

# Enable server extension
jupyter server extension enable jupyterlab_pegasus

# Launch
jupyter lab
```

## Configuration

Set your LLM provider in `~/.pegasus-ai/.env`:

```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

Supported: `anthropic`, `openai`, `fabric`, `nrp`, `ollama`, `custom`.

## Usage

In a notebook: right-click → **Insert Pegasus Cell**, or use the Edit menu.
