---
description: Show the current ETNA pipeline status for a project
---

# ETNA Pipeline Status

Show the current state of the workload generation pipeline.

## Arguments

- `$1` — project directory path

## Instructions

1. Use `etna_pipeline_status` for the project at `$1`.
2. Report:
   - Run ID and overall status (idle/running/completed/failed)
   - Which stages are complete (with checkpoint file sizes and timestamps)
   - Which stages are pending
   - Any recorded errors or failed attempts
   - If mutations checkpoint exists, show the mutation count
   - If report checkpoint exists, show the summary counts

## Project: $1
$@
