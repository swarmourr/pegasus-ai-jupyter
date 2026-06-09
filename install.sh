#!/bin/bash
# Development install — run from inside the jupyterlab-pegasus folder
set -e

echo "=== Step 1: Install Python backend ==="
pip install hatchling
pip install -e "."

echo ""
echo "=== Step 2: Clean any previous npm state ==="
rm -rf node_modules .pnp.cjs .yarn .yarnrc.yml yarn.lock

echo ""
echo "=== Step 3: Install npm deps ==="
npm install

echo ""
echo "=== Step 4: Build TypeScript ==="
npm run build:lib

echo ""
echo "=== Step 5: Build labextension ==="
npm run build:labextension

echo ""
echo "=== Step 6: Link into JupyterLab ==="
jupyter labextension develop --overwrite .

echo ""
echo "=== Step 7: Enable server extension ==="
jupyter server extension enable jupyterlab_pegasus

echo ""
echo "=== All done! ==="
echo ""
echo "To develop:"
echo "  Terminal 1:  npm run watch:src"
echo "  Terminal 2:  jupyter lab"