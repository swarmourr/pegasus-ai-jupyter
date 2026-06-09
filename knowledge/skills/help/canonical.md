# Pegasus AI — Available Skills

Welcome! Here are all the skills available in this Pegasus AI assistant:

| Skill | Command | Description |
|-------|---------|-------------|
| **Scaffold** | `/scaffold` | Generate a complete Pegasus workflow project from a pipeline description |
| **Wrapper** | `/wrapper` | Create Python or shell wrapper scripts for pipeline steps |
| **Dockerfile** | `/dockerfile` | Generate a Dockerfile for your workflow's tool stack |
| **Convert** | `/convert` | Convert Snakemake or Nextflow pipelines to Pegasus format |
| **Debug** | `/debug` | Diagnose workflow failures using pattern matching and log analysis |
| **Review** | `/review` | Audit your workflow against an 8-category best-practices checklist |
| **Kiso** | `/kiso` | Generate a `experiment.yml` for running workflows on cloud infrastructure |
| **Provd** | `/provd` | Deploy a workflow — estimate resources, provision infrastructure, generate site catalog |

## Recommended Workflow

1. **New workflow** → start with `/scaffold`
2. **Adding steps** → use `/wrapper` for each new job
3. **Containerization** → use `/dockerfile`
4. **Migrating a pipeline** → use `/convert`
5. **Something broke** → use `/debug`
6. **Before submitting** → use `/review`
7. **Deploy to cloud/HPC** → use `/kiso` then `/provd`

## Core Pegasus Architecture

Every Pegasus workflow needs five components:
- **Properties** — runtime settings
- **Site Catalog** — execution locations
- **Transformation Catalog** — executables and containers
- **Replica Catalog** — input files and support data
- **Workflow** — jobs, files, and dependencies

What would you like to work on?
