---
description: Evaluate a Rust project for ETNA suitability or search for new workload candidates
---

# Project Suggestion

Evaluate whether a Rust project is suitable for ETNA workload generation, or suggest new candidates.

## Arguments

- `$1` — (optional) repository URL or local path to evaluate
- If no argument is given, search for and suggest new candidate projects

## Instructions

Load the etna-suggest skill and follow its evaluation criteria.

### If evaluating a specific project ($1):

1. Clone or navigate to the repository
2. Run the 9-criterion evaluation scorecard
3. If the composite score is 25+ out of 45, recommend proceeding
4. Note any risks or caveats

### If searching for candidates:

1. Consider the existing workloads to understand what's already covered
2. Look for Rust crates in categories: data-structures, algorithms, parser-implementations, encoding
3. Prioritize crates that depend on both proptest and quickcheck
4. Evaluate top 3-5 candidates with full scorecards
5. Rank by composite score

## Project: $1
$@
