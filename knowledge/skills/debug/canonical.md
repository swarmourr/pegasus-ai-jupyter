# Skill: debug

Diagnose and fix Pegasus workflow failures.

## Steps

1. Run `pegasus-analyzer <submit_dir>` and parse the output
2. Identify failed jobs and their error messages
3. Read the job's stderr/stdout logs from the submit directory
4. Explain the root cause in plain language
5. Suggest a fix (code change, config change, or retry)
6. If a fix is clear, implement it and explain what changed

## Common failure patterns

- **Missing input file**: check ReplicaCatalog entries and file paths
- **Transformation not found**: check TransformationCatalog pfn and site
- **Container pull failure**: check Docker image name and registry access
- **OOM / timeout**: suggest resource adjustment in pegasus.properties
- **HTCondor hold**: run `condor_q -held` and explain the hold reason
