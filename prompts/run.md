---
description: Build an ETNA workload from a Rust project by mining its entire git history
---

# ETNA Workload Generation

Mine the **entire** git history of a Rust project, turn every viable bug fix into a mutation+property+witness triplet with adapters for proptest / quickcheck / crabcheck / hegel, and ship it as an ETNA workload.

## Arguments

- `$1` — project directory (e.g. `workloads/Rust/ordered-float`). Must already be a git working tree.

## Pipeline

Run these five stages in order. Each stage's instructions live in its `SKILL.md`.

1. `skills/discover/SKILL.md` — full history scan, in-memory candidate list.
2. `skills/atomize/SKILL.md` — for **every** candidate: extract fix, write property + 4 framework adapters, inject via marauders or patch, write witness, verify, commit to `etna/<variant>` branch, append to `etna.toml`.
3. `skills/runner/SKILL.md` — populate `src/bin/etna.rs` with programmatic dispatch over (tool, property).
4. `skills/document/SKILL.md` — generate `BUGS.md` and `TASKS.md` by reading the source tree.
5. `skills/validate/SKILL.md` — end-to-end sanity check across base + variants + frameworks + docs.

## Non-negotiables

- **No checkpoint JSONs.** The source tree, `etna.toml`, and git branches are the only durable state.
- **No ranking filter.** Every bug-fix commit becomes a variant unless there is a terminal reason not to (no observable invariant, surface removed, irreducibly nondeterministic).
- **Property function is the portable unit.** `pub fn property_<name>(inputs) -> PropertyResult` lives in source. Every framework adapter calls it. The witness calls it. `etna.rs` calls it.
- **Witness is concrete and deterministic.** `#[test]` named `witness_<name>_case_<tag>`, calling `property_<name>` with frozen inputs. Passes on base, fails on variant.
- **Cross-framework parity.** Each property has adapters for proptest, quickcheck, crabcheck, and hegel. Use the forked quickcheck at `/Users/akeles/Programming/projects/PbtBenchmark/quickcheck` (feature `etna`) and crabcheck at `/Users/akeles/Programming/projects/PbtBenchmark/crabcheck`.
- **Two injection paths.** Marauders comment syntax for localized edits; `patches/<variant>.patch` for everything else. No candidate is dropped for being too distributed.

## Project: $1
$@
