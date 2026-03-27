# pi-etna: ETNA Workload Generation Agent

## What This Package Does

pi-etna drives an LLM-guided pipeline that turns Rust projects with property-based tests into ETNA workloads. It scans git history for bug fixes and injects marauders mutations that recreate those bugs.

## Architecture

- **Tools** are thin mechanical wrappers around git, cargo, and marauders CLI commands
- **Skills** contain per-stage reasoning instructions and output schemas
- **The agent (you) makes all judgment calls**: classifying commits, ranking candidates, deciding mutation expressibility, writing tests, injecting mutations
- **Orchestrator** manages pipeline state, checkpoints, and gate enforcement

## Available Tools

- `etna_git_batch`, `etna_git_show`, `etna_git_diff_range` — git history traversal
- `etna_marauders_list`, `etna_marauders_convert` — mutation framework
- `etna_cargo_test_base`, `etna_cargo_test_variant` — test execution
- `etna_checkpoint_write`, `etna_checkpoint_read`, `etna_checkpoint_list` — checkpoint state
- `etna_pipeline_status`, `etna_pipeline_advance`, `etna_pipeline_gate_check` — orchestration

## Pipeline Stage Order

```
candidates → ranked → fixes → classified → tests → mutations → report → docs → validation
```

## Key Rules

1. **Always include `run_id` and `project`** in checkpoint data
2. **Never hand-author numeric summaries** — derive counts from checkpoint array lengths
3. **Always verify base tests pass** before accepting mutations (`etna_cargo_test_base`)
4. **Always verify variant tests fail** before retaining mutations (`etna_cargo_test_variant`)
5. **Use functional mutation syntax during testing**, comment syntax for final output
6. **Mutation naming**: `<descriptive_name>_<7-char-commit-hash>_<sequence>`
7. **Every removal needs a reason** — no silently dropping mutations

## Marauders CLI

```sh
marauders list --path <project_dir>        # list all mutations
marauders convert --path <file> --to functional  # convert for testing
marauders convert --path <file> --to comment     # convert for final output
```

## Marauders Comment Syntax

```rust
/*| mutation_name [tag1, tag2] */
<fixed code (base)>
/*|| variant_name */
/*|
<buggy code (variant)>
*/
/* |*/
```

## Test Execution Strategy

Tests use functional mutations to avoid recompilation between variants:
1. Convert to functional: `etna_marauders_convert` with `to: "functional"`
2. Run with variant: `etna_cargo_test_variant` (sets `M_<variant>=active`)
3. Convert back to comment: `etna_marauders_convert` with `to: "comment"`

## Checkpoint Directory

All stage outputs go to `<project_dir>/checkpoints/<stage>.json`.
Pipeline state lives at `<project_dir>/checkpoints/pi_etna_state.json`.
