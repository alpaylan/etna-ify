---
description: Resume an ETNA pipeline from a specific stage
---

# Resume ETNA Pipeline

Resume the workload generation pipeline from where it left off (or from a specific stage).

## Arguments

- `$1` — project directory path
- `$2` — (optional) stage to resume from

## Instructions

1. Check current status with `etna_pipeline_status` for the project at `$1`.
2. If a `$2` stage is specified, the pipeline should resume from that stage.
3. For each incomplete stage:
   a. Read prior checkpoints with `etna_checkpoint_read` for context
   b. Load the corresponding skill
   c. Execute the stage following skill instructions
   d. Write checkpoint and advance pipeline
4. Run gate checks after completing relevant stages.
5. Report final status.

## Project: $1
Starting from: $2
$@
