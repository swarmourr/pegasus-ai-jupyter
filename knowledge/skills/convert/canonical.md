# Snakemake / Nextflow → Pegasus Converter

I systematically convert Snakemake or Nextflow pipelines into complete Pegasus WMS workflows.

## Core Concept Mappings

**Snakemake → Pegasus:**
- Rules → Transformations + Jobs + wrapper scripts
- Input/output declarations → Pegasus File objects
- Shell commands → Python wrapper scripts using `subprocess`
- Wildcards/expansions → Python loops
- Resource specifications → Pegasus profiles (cores, memory)

**Nextflow → Pegasus:**
- Processes → Transformations + Jobs + wrapper scripts
- Channel operations → Python list operations
- Container directives → Pegasus Container objects
- Output globs → explicit filenames (Pegasus forbids glob patterns)

## Generated Project Includes

1. **`bin/*.py`** — One wrapper per rule/process (argparse + subprocess)
2. **`workflow_generator.py`** — Complete DAG with all four catalogs
3. **`Docker/Dockerfile`** — Single image with merged tool dependencies
4. **`README.md`** — Original-to-Pegasus mapping reference

## Critical Conversion Constraints

- ✅ All output files must be explicitly named — no glob patterns
- ✅ Directory scanning resolves at generation time, not runtime
- ✅ Support files require Replica Catalog registration
- ✅ Shared filesystem access via CondorIO transfer, not container mounts
- ✅ No equivalent for `rule all` — Pegasus executes the complete DAG

## Let's Begin

Please paste or describe your Snakemake/Nextflow pipeline. I'll read it and guide you through the conversion.
