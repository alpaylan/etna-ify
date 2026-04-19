---
name: validate
description: End-to-end sanity check — base passes, every variant is detectable, every framework runs, docs match source
---

# Stage: Validate

## Objective

Confirm the workload is coherent and runnable. No separate checkpoint file; validate by executing real commands against the real source tree.

## Preconditions

- `etna.toml` exists at project root.
- `src/bin/etna.rs` compiles.
- `BUGS.md` and `TASKS.md` exist.
- Project HEAD is the base commit; per-variant commits live on `etna/<variant>` branches.

## Checks

Run each check. The workload is valid only when every check passes. Any failure must point at the earlier stage that needs to be fixed — do not mask failures here.

### 1. Base builds and tests

```sh
cargo -C <project> build --release --bin etna
cargo -C <project> test
cargo -C <project> run --release --bin etna -- etna All
```

All three exit 0.

### 2. etna.toml ↔ source tree consistency

For every `[[variant]]` entry in `etna.toml`:

- If `injection = "marauders"`: name appears in `marauders list --path <project>`.
- If `injection = "patch"`: `patches/<variant>.patch` exists and `git apply --check patches/<variant>.patch` succeeds from base.
- `property_<name>` exists in source (`grep -rn "pub fn property_<name>" src/`).
- Every listed witness name exists as a `#[test]` (`grep -rn "fn witness_<name>_case_"`).
- The name token `case_` is present in at least one witness name.

### 3. Per-variant detection (the core assertion)

For each variant:

1. On base HEAD: `cargo test witness_<name>_case_` — all witness tests pass.
2. Activate mutation:
   - Marauders: `marauders convert --path <file> --to functional`, then `M_<variant>=active cargo test witness_<name>_case_`.
   - Patch: `git worktree add /tmp/etna-<variant> etna/<variant>`, then `cargo test --manifest-path /tmp/etna-<variant>/Cargo.toml witness_<name>_case_`, then `git worktree remove /tmp/etna-<variant>`.
3. Expected: **at least one witness test fails** under the mutation.

If step 3 doesn't fail, the variant is not detected. That's a validation failure — the atomize stage must be redone for this variant.

After marauders testing, `marauders convert --path <file> --to comment` to restore.

### 4. etna binary end-to-end

```sh
cargo run --release --bin etna -- etna All
cargo run --release --bin etna -- proptest All
cargo run --release --bin etna -- quickcheck All
cargo run --release --bin etna -- crabcheck All
cargo run --release --bin etna -- hegel All
```

All exit 0 on base HEAD — including FAIL paths. Every invocation must print exactly one JSON line to stdout containing `status`, `tests`, `time`, and either `counterexample` or `error`. A `PASS:/FAIL:` text line instead of JSON means the runner hasn't been updated to the etna `log_process_output` contract (`etna2/src/driver.rs:1400`) — etna will skip it during line-by-line JSON parsing and only persist the process-exit-status abort record.

Smoke test at least one variant per framework by checking out its branch (or activating `M_<variant>=active` / `marauders set --variant <name>` for patch variants) and confirming the JSON line has `"status":"failed"` with a `counterexample`. `tests` should be plausibly > 1 — a hard-coded `tests=1` across every framework is a strong signal of a stub delegating to the witness path.

Run `etna experiment run --name <exp> --tests <stem>` end-to-end and inspect the resulting `store.jsonl`: every record for ordered-float-style runs should have `status ∈ {passed, failed}`, not `aborted`. `aborted` in the store means the adapter exited non-zero or crashed — re-read the abort `error` field and fix the adapter, do not paper over it by re-running.

### 5. Docs ↔ source consistency

- `BUGS.md` has one row in the Bug Index per `[[variant]]` in `etna.toml`.
- `BUGS.md` "Total mutations: N" equals `len(etna.toml.variant)`.
- `TASKS.md` has one row per (variant, framework) pair.
- Every variant name in `etna.toml` is referenced in both `BUGS.md` and `TASKS.md` (backtick-quoted).
- Every witness name in `etna.toml` is referenced in `TASKS.md`.

### 6. Commits

- Every variant has an `etna/<variant>` branch.
- Every `etna/<variant>` branch has exactly one commit past its `base_commit`.
- Every branch's `base_commit` is the same HEAD SHA. **Print that SHA in the validate report** (e.g. `shared base: d637653`) — a divergent-parents bug manifests as four different parents across four variants and is easy to miss without seeing the number.
- The shared `base_commit` equals the current master HEAD SHA. If master has advanced — commonly because `src/bin/etna.rs` was just updated — every `etna/<variant>` branch must be rebuilt from the new master (delete the branch, re-apply `patches/<variant>.patch` on a fresh branch off master HEAD) before validate will pass. A stale variant branch holds a pre-update bin and produces phantom zero-metrics on variant runs.
- `git log etna/<variant>..etna/<other>` shows no shared commits beyond base (parallel branches).

### 7. No placeholder state

Grep the source and docs for `TODO`, `FIXME`, `not yet`, `not injected`, `placeholder`, `blocked by base`. None may appear in workload-critical files (`etna.toml`, `BUGS.md`, `TASKS.md`, witness tests, property functions, `src/bin/etna.rs`).

### 7a. Adapter-body reality check

A framework listed in the public usage help must actually drive its own crate. Extract each `run_<tool>_property` function body from `src/bin/etna.rs` and verify the body references the expected crate identifier:

| Adapter | Required identifier in body |
|---|---|
| `run_proptest_property` | `proptest::` |
| `run_quickcheck_property` | `QuickCheck` (type) or `quickcheck::` |
| `run_crabcheck_property` | `crabcheck::` or `cc::quickcheck` |
| `run_hegel_property` | `hegel::` or `Hegel::` |

A body that only calls `run_etna_property` or `check_<name>()` is a **stub**. Silent stubs compile, pass the TODO/FIXME grep, and produce always-`tests=1` numbers that silently misrepresent cross-framework comparison. Reject them.

A reasonable implementation:

```sh
# Pseudocode for the check.
for tool in proptest quickcheck crabcheck hegel; do
    body=$(awk "/fn run_${tool}_property/,/^}/" src/bin/etna.rs)
    expected_token_for "$tool" || fail "stub: run_${tool}_property does not reference its framework crate"
done
```

## Output

Print a one-line summary per check:

```
[PASS] 1. base builds and tests
[PASS] 2. etna.toml ↔ source consistency (N variants)
[FAIL] 3. per-variant detection — variant foo_abc1234_1 undetected
...
```

And an overall `[PASS]` or `[FAIL]` footer. No JSON output required.
