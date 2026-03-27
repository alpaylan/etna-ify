---
name: etna-ranked
description: Rank and filter bug-fix candidates by suitability for mutation injection
---

# Stage: Ranked

## Objective

Take the candidate list from the `candidates` stage and rank them by suitability for marauders mutation injection. Filter out unsuitable candidates and order the rest by injection priority.

## Execution Steps

1. Read the candidates checkpoint with `etna_checkpoint_read` (stage: "candidates").
2. For each candidate, use `etna_git_show` to inspect the full diff if needed.
3. Score each candidate on four axes (each 1-5):
   - **Locality**: prefer small, localized diffs (1-3 hunks, 1-2 files)
   - **Semantic clarity**: prefer bugs with clear semantics (off-by-one, missing check, wrong operator) over complex behavioral bugs
   - **Testability**: prefer bugs in code covered by existing property-based tests
   - **Diversity**: balance across mutation types and code regions
4. Compute a composite score and rank candidates.
5. Remove candidates that are clearly unsuitable (e.g., too large, spanning many files).
6. Write the checkpoint with `etna_checkpoint_write`.

## Ranking Heuristics

- **Best candidates**: single-line or few-line changes to a core implementation file, with a corresponding test change in the same commit
- **Good candidates**: small changes with clear bug semantics, even without test changes
- **Marginal candidates**: medium-sized diffs where the bug fix can be isolated from surrounding changes
- **Reject**: large refactors mixed with a fix, changes spanning 5+ files, changes to generated code

## Output Schema

```json
{
  "run_id": "<uuid>",
  "project": "<name>",
  "total_candidates": 20,
  "ranked_count": 15,
  "ranked": [
    {
      "hash": "<commit_hash>",
      "date": "<ISO8601>",
      "message": "<commit message>",
      "author": "<name <email>>",
      "files": ["src/algo/foo.rs"],
      "file_count": 1,
      "hunk_count": 2,
      "score": 18,
      "locality": 5,
      "clarity": 4,
      "testability": 4,
      "diversity": 5,
      "rationale": "Single-line operator fix in core algorithm with existing PBT coverage"
    }
  ],
  "removed": [
    {
      "hash": "<commit_hash>",
      "reason": "Too large — 12 files changed across multiple modules"
    }
  ]
}
```

## Quality Criteria

- Retain at least 10 candidates from a pool of 20
- Rankings reflect genuine suitability, not arbitrary ordering
- Each removed candidate has a clear reason
- Diversity across bug types: aim for a mix of expression-level, statement-level, and structural bugs
