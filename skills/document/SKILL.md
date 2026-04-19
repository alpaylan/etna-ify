---
name: document
description: Generate BUGS.md and TASKS.md by reading the source tree directly — no checkpoint JSONs
---

# Stage: Document

## Objective

Produce `BUGS.md` and `TASKS.md` for the workload. Every number and every row must be derivable from the source tree + `etna.toml`. No hand-authored counts. No reliance on intermediate JSON files.

## Sources of truth

In order of authority:

1. `etna.toml` — variant → property mapping, injection kind, source commit, witnesses, frameworks.
2. `marauders list --path <project>` — actual injected marauders variants with file:line locations.
3. `ls patches/*.patch` — actual patch-based variants.
4. `grep -rn "pub fn property_" src/` — actual property functions in source.
5. `grep -rn "fn witness_.*_case_" src/ tests/` — actual witness tests.

Before writing docs, cross-check: every `etna.toml` variant with `injection = "marauders"` must appear in `marauders list`; every `injection = "patch"` must have `patches/<variant>.patch`. If a mismatch exists, fix the source tree — do **not** paper over it in the docs.

## BUGS.md shape

```markdown
# <Project> — Injected Bugs

Total mutations: <N>   <!-- derived: len(etna.toml.variant) -->

## Bug Index

| # | Name | Variant | File | Injection | Fix Commit |
|---|------|---------|------|-----------|------------|
| 1 | `<name>` | `<variant>` | `<file>:<line>` or `patches/<variant>.patch` | `marauders` or `patch` | `<full-hash>` |

## Property Mapping

| Variant | Property | Witness(es) |
|---------|----------|-------------|
| `<variant>` | `property_<name>` | `witness_<name>_case_<tag>` |

## Framework Coverage

| Property | proptest | quickcheck | crabcheck | hegel |
|----------|---------:|-----------:|----------:|------:|
| `property_<name>` | ✓ | ✓ | ✓ | ✓ |

## Bug Details

### 1. <name>
- **Variant**: `<variant>`
- **Location**: `<file>:<line>` (or `patches/<variant>.patch`)
- **Property**: `property_<name>`
- **Witness(es)**: `witness_<name>_case_<tag>`
- **Fix commit**: `<full-hash>` — `<commit subject>`
- **Invariant violated**: <one-sentence statement of the property the bug breaks>
- **How the mutation triggers**: <one-sentence description of the exact change>
```

## TASKS.md shape

```markdown
# <Project> — ETNA Tasks

Total tasks: <T>   <!-- derived: sum over variants of len(variant.frameworks) -->

ETNA tasks are **mutation/property/witness triplets**. Each row below is one runnable task.

## Task Index

| Task | Variant | Framework | Property | Witness | Command |
|------|---------|-----------|----------|---------|---------|
| 001  | `<variant>` | proptest | `property_<name>` | `witness_<name>_case_<tag>` | `cargo run --release --bin etna -- proptest <PropertyKey>` |

## Witness catalog

Each witness is a deterministic concrete test. Base build: passes. Variant-active build: fails.

- `witness_<name>_case_<tag>` — `<inputs>` → `<expected>`
```

## Generation procedure

1. Parse `etna.toml` into a list of variants.
2. For each variant:
   - Confirm injection artifact exists (`marauders list` entry or `patches/<variant>.patch`).
   - Read the `source_commit` and fetch its subject via `git show -s --format=%s <hash>`.
   - Confirm every listed witness name is present in the source (`grep`).
   - Confirm `property_<name>` exists (`grep`).
3. For each property, determine framework coverage by greppping for `proptest_<name>`, `quickcheck_<name>`, `crabcheck_<name>`, and the hegel witness path.
4. Emit `BUGS.md`, `TASKS.md`.

## Rules

- Numeric cells (`Total mutations`, `Total tasks`, framework coverage) are computed inline from the data above. Never type them by hand.
- File paths in `BUGS.md` match exactly what `marauders list` reports (with project-relative prefix).
- Variant names in `BUGS.md` and `TASKS.md` are backtick-quoted so the validate stage can grep them.
- Drop-reason notes for skipped candidates are **not** documented here. `etna.toml` comments are enough; the public workload only advertises live variants.
- If `BUGS.html` is required for deployment, generate it from `BUGS.md` via pandoc or a simple markdown→html pass. Not required for validation.
