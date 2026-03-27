---
name: etna-validation
description: Validate cross-checkpoint consistency and produce pass/fail report
---

# Stage: Validation

## Objective

Run strict consistency checks across all checkpoint files and the generated documentation. This is the final gate before a workload is considered complete.

## Execution Steps

1. Use `etna_pipeline_gate_check` with `gate: "source_commit"` to verify each mutation's source commit matches the extracted buggy/fixed snippet.
2. Use `etna_pipeline_gate_check` with `gate: "cross_checkpoint"` for the automated invariant checks.
3. Additionally verify:
   - BUGS.md exists and contains entries for every final mutation
   - `marauder.toml` exists in the project directory
   - Mutation source files still contain valid marauders comment syntax
   - `etna_marauders_list` returns all expected mutations
   - File paths in BUGS.md match the full paths in mutations.json (e.g., `roaring/src/bitmap/store/bitmap_store.rs:575`, not just `bitmap_store.rs:575`)
   - Mutation count is checked against the 20-50 target range
4. **CRITICAL: Write `validation.json` checkpoint** using `etna_checkpoint_write` with stage "validation". This checkpoint is REQUIRED — the pipeline is not complete without it. The validation stage must always produce a checkpoint, even if validation fails.

## Invariants Checked

These are the invariants from the pipeline specification:

1. `report.summary.candidates_identified == len(candidates.candidates)`
2. `report.summary.mutations_final == len(report.final_mutations)`
3. Every mutation in `report.final_mutations` exists in `mutations.json` by variant
4. Every failing test in `report.final_mutations` exists in `tests.json`
5. Every removed mutation has a reason and does not appear in final mutations
6. `report.summary.mutations_undetected == 0`
7. Every final mutation has at least one failing regression test in `tests.json`
8. Every final mutation has a canonical failing property test in `docs.json`
9. Every final mutation variant appears in BUGS.md with matching property test
10. All checkpoints share the same `run_id`
11. Every mutation source commit matches the extracted buggy/fixed snippet in `fixes.json` (via `source_commit` gate)

## Output Schema

```json
{
  "run_id": "<uuid>",
  "project": "<name>",
  "passed": true,
  "checks": {
    "candidates_count_match": true,
    "mutations_final_count_match": true,
    "all_final_mutations_in_mutations_json": true,
    "all_final_mutations_in_tests_json": true,
    "no_undetected_mutations": true,
    "all_mutations_have_failing_tests": true,
    "all_mutations_have_property_detectors": true,
    "all_mutations_in_bugs_md": true,
    "consistent_run_ids": true,
    "marauders_list_matches": true
  },
  "mismatches": []
}
```

## On Failure

If any check fails:
- The pipeline status should be set to "failed" via `etna_pipeline_advance` with `action: "fail"`
- The mismatch report should clearly identify which checks failed and why
- Do NOT mark the workload as complete
- Provide actionable guidance on which earlier stage needs correction
