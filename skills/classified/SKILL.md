---
name: etna-classified
description: Classify each extracted fix by mutation expressibility and difficulty for marauders injection
---

# Stage: Classified

## Objective

Before attempting injection, classify each candidate fix by how well it maps to a marauders mutation. Determine expressibility and difficulty to help prioritize injection work.

## Execution Steps

1. Read the fixes checkpoint with `etna_checkpoint_read` (stage: "fixes").
2. For each fix, assess:
   - **Expressibility**: Can this bug be faithfully recreated using marauders mutation syntax?
   - **Difficulty**: How hard is the injection?
   - **Faithfulness**: How close is the mutation to the original bug?

## Classification Levels

### Expression-level (easy)
- Wrong operator (`+` instead of `-`, `<` instead of `<=`)
- Wrong constant or literal
- Swapped arguments
- Wrong variable reference
- Maps directly to marauders variant syntax: swap one expression for another

### Statement-level (medium)
- Missing or extra statement (e.g., forgotten bounds check)
- Wrong branch condition
- Missing return or break
- Expressible by wrapping a block in a mutation variant
- For missing-code bugs: the mutation *removes* the check in the buggy variant

### Structural (hard)
- Missing control flow (loop, match arm)
- Wrong algorithm choice
- Missing feature or trait implementation
- May require creative encoding or may not be expressible at all
- **Mark as `expressible: false` if marauders cannot faithfully represent it**

## Output Schema

```json
{
  "run_id": "<uuid>",
  "project": "<name>",
  "count": 13,
  "classified": [
    {
      "commit": "<hash>",
      "mutation_name": "foo_wrong_operator",
      "variant": "foo_wrong_operator_abc1234_1",
      "file": "src/algo/foo.rs",
      "mutation_type": "expression",
      "difficulty": "easy",
      "expressible": true,
      "rationale": "Simple operator swap from + to -, maps directly to a two-variant mutation",
      "buggy_code": "a - b",
      "fixed_code": "a + b"
    }
  ],
  "deferred": [
    {
      "commit": "<hash>",
      "mutation_name": "complex_algo_change",
      "reason": "Requires restructuring a 30-line match block — not expressible as a marauders variant"
    }
  ]
}
```

## Quality Criteria

- Every fix gets a classification — none are silently dropped
- `expressible: false` has a clear rationale explaining why
- Difficulty reflects actual implementation effort, not just diff size
- Deferred candidates have explicit reasons
- At least 60% of candidates should be expressible for a well-chosen candidate set
