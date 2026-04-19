# pi-etna: ETNA Workload Generation

## What this is

pi-etna takes a Rust project with property-based tests, mines its entire git history for bug fixes, and produces an ETNA workload: every bug lives as a mutation, every mutation has a framework-neutral property function, a deterministic witness, and adapters for proptest / quickcheck / crabcheck / hegel. A single `src/bin/etna.rs` dispatcher drives them programmatically.

## Pipeline (5 stages)

```
discover  ->  atomize  ->  runner  ->  document  ->  validate
```

1. **discover** — full `git log --all` scan, keep every fix commit.
2. **atomize** — per candidate: extract fix, write property + adapters, inject mutation, write witness, verify, commit to `etna/<variant>` branch.
3. **runner** — `src/bin/etna.rs` dispatches `<tool> <property>` programmatically.
4. **document** — generate `BUGS.md` + `TASKS.md` from source truth.
5. **validate** — base passes, every variant detected, every framework runs, docs consistent.

## Source-of-truth rule

The source tree, `etna.toml`, and git branches are the only durable state. No checkpoint JSONs, no intermediate manifests. Numbers in docs are always derived from the tree.

`etna.toml` lives at project root. One `[[variant]]` table per mutation. Every other fact (file:line, framework coverage, witnesses) is recoverable via `marauders list`, `ls patches/`, or `grep`.

## Property function contract

```rust
pub fn property_<name>(inputs: T) -> PropertyResult
```

Returns `PropertyResult::{Pass, Fail(String), Discard}`. Deterministic, totally pure, takes owned concrete inputs. Reused by every framework adapter and by the witness. Never re-implemented inside an adapter.

## Witness contract

A witness is a concrete `#[test]` named `witness_<name>_case_<tag>` that calls `property_<name>` with frozen inputs. Passes on base HEAD, fails on `M_<variant>=active` or on the `etna/<variant>` branch. No RNG, no clock, no `proptest!` macros, no `#[quickcheck]`.

## Injection: marauders vs patch

- **Marauders** (preferred for localized changes): comment syntax in the source file, activated by `M_<variant>=active` for testing.
- **Patch** (fallback): `patches/<variant>.patch` applied to a fresh worktree off the base commit. Used when the fix spans many files or is too intertwined for clean marauders extraction. The runner does not need to know about patches — the `etna/<variant>` branch has them already applied.

## Frameworks and where they live

- `proptest` — crates.io.
- `quickcheck` — fork at `/Users/akeles/Programming/projects/PbtBenchmark/quickcheck` (feature `etna`).
- `crabcheck` — `/Users/akeles/Programming/projects/PbtBenchmark/crabcheck`.
- `hegel` — crates.io `hegeltest = "0.3.7"` (import path `hegel::`). Drives its own `Hegel::new(...).run()` loop, catches panic on counterexample, and downcasts the payload. **Never** stub hegel by delegating to `run_etna_property` or the witness replay — that produces always-`inputs=1` numbers and silently misrepresents the benchmark. The local `/Users/akeles/Programming/projects/PbtBenchmark/hegel-rust` crate (v0.4.5) does not compile as of 2026-04; stay on crates.io 0.3.7. Hegeltest 0.3.7 defaults to a Python/uv subprocess backend, adding ~650 ms startup per run.

## Invariants

- One commit per variant. All variants share the same `base_commit`, and that SHA equals current master HEAD.
- `marauders list` and `patches/` are consistent with `etna.toml`.
- `BUGS.md` total mutations count = `len(etna.toml.variant)`.
- `TASKS.md` total tasks = `sum(len(variant.frameworks))`.
- No placeholder text in workload-critical files.
- Every `run_<tool>_property` in `src/bin/etna.rs` actually drives its own framework crate — no stub delegating to `run_etna_property` or a witness replay.
- Every runner invocation emits a single JSON line to stdout with `{status: "passed"|"failed"|"aborted", tests: N, time: "<us>us", counterexample, error}` and exits with status 0 (except arg-parse errors). Etna's `log_process_output` at `etna2/src/driver.rs:1400` marks any non-zero exit as `status: aborted` and ignores human-readable PASS/FAIL text — so a framework that catches a counterexample but a `main` that exits 1 still produces abort records instead of failures.
- Framework adapters wrap their run loops in `std::panic::catch_unwind` with a silenced panic hook so panics from the library-under-test (e.g. `NotNan` asserting on NaN results) don't leak to stderr, and the adapter can attribute the panic to the counterexample rather than aborting.

## Not doing anymore

- No `candidates` / `ranked` / `fixes` / `classified` / `tests` / `mutations` / `tasks` / `commit` / `report` / `docs` / `validation` split. Collapsed into 5 stages.
- No 50-commit batching. No expansion stage. Full history in one pass.
- No checkpoint JSON files. Source tree is the truth.
- No ranking filter. Every fix becomes a variant unless terminally inexpressible.
- No subprocess dispatch in `etna.rs`. Direct library calls to each framework's runner.
