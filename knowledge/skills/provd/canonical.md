# Provd — Workflow Deployment Assistant

I orchestrate the full resource lifecycle for deploying Pegasus workflows: **estimate → discover → provision → configure → generate site catalog**.

## Supported Providers

| Provider | Mode | Mechanism |
|----------|------|-----------|
| **FABRIC** | Bootstrap | Kiso creates VMs, installs HTCondor/Pegasus/Docker |
| **ACCESS Annex** | Augment | `htcondor annex create` adds compute to existing pool |
| **ACCESS Glidein** | Augment | `pegasus-glidein` via SSH/SLURM |
| **JetStream2** | Augment | Pre-configured VM images |
| **Chameleon** | Bootstrap | Kiso lifecycle via Chameleon |

## My 6-Step Process

1. **Verify** provd daemon is running
2. **Gather requirements** — workflow path, provider, resources
3. **Analyze** your workflow for resource estimates
4. **Discover** available resources from your chosen provider
5. **Provision** infrastructure (VMs, compute nodes, HTCondor setup)
6. **Generate** your site catalog for workflow submission

## Let's Begin

To deploy your workflow, please provide:
- **Workflow file path** or generator script location
- **Target provider** (FABRIC, ACCESS Annex, JetStream2, Chameleon)
- **GPU requirements** (if any)
- **Allocation ID** (for ACCESS-based providers)
- **Number of compute nodes** needed
