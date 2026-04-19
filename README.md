# pi-etna

ETNA workload generation for Rust projects with property-based tests.

Given a Rust project, pi-etna mines its entire git history, turns every bug fix into a mutation, and produces a cross-framework benchmarkable workload. Every mutation comes with a framework-neutral property function, a deterministic witness, and adapters for proptest, quickcheck, crabcheck, and hegel.

See `AGENTS.md` for the architecture, `prompts/run.md` for the entry point, and `skills/<stage>/SKILL.md` for per-stage reasoning.

## Pipeline

```
discover  ->  atomize  ->  runner  ->  document  ->  validate
```

- **discover** — full `git log --all`, every fix commit is a candidate.
- **atomize** — one fix → property + 4 framework adapters + witness + mutation + commit.
- **runner** — `src/bin/etna.rs` dispatches `<tool> <property>` programmatically.
- **document** — `BUGS.md` and `TASKS.md` generated from the source tree.
- **validate** — base passes, every variant is detected, every framework runs.

## Source of truth

- `etna.toml` — the only hand-maintained index, one `[[variant]]` per mutation.
- `marauders list` — injected marauders variants.
- `patches/*.patch` — patch-based variants.
- Source `pub fn property_*` and `fn witness_*_case_*` — properties and witnesses.
- Git `etna/<variant>` branches — per-variant committed workload states.

No checkpoint JSONs.

## Workloads

Produced workloads live under `workloads/Rust/`. Each has its own `BUGS.md`, `TASKS.md`, `etna.toml`, `src/bin/etna.rs`, and parallel `etna/<variant>` branches.
