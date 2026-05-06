---
description: Build an ETNA workload from the Cedar-Lean formal specification by mining its git history
---

# ETNA Workload Generation — Cedar (Lean 4)

Mine the git history of `cedar-policy/cedar-spec`'s `cedar-lean/Cedar/` tree, turn every viable Lean-side bug fix into a mutation+property+witness triplet, and ship it as an ETNA workload at `workloads/Lean/Cedar`.

This is the Lean 4 / Cedar analogue of `prompts/run.md`. The shape is the same — five stages, no checkpoint JSONs, `etna.toml` is the source of truth — but every stage is tooled for Lean rather than Rust. **Read this entire file before starting**; the pivots from the Rust pipeline are non-trivial.

## Arguments

- `$1` — project directory (e.g. `workloads/Lean/Cedar`). Must already be a git working tree containing the upstream `cedar-spec` history and the `cedar-lean/` subtree as the active workdir. The bootstrap script `scripts/etnaify_cedar.sh` produces this layout.

## Pipeline

```
discover  ->  atomize  ->  runner  ->  document  ->  validate
```

Run them in order. Skill files in `etna-ify/skills/<stage>/SKILL.md` describe the *Rust* mechanics; the Cedar-specific deltas in this file override them.

1. **discover** — `git log --all -- 'Cedar/**'` and `git log --all -- 'cedar-lean/Cedar/**'` (depending on subtree depth). Keep every commit whose subject or body matches `^(fix|bug|address|correct|panic|crash|incorrect|wrong|TPE|symcc).*` and whose diff touches a `.lean` file under `Cedar/`. Drop pure proof-only changes (a commit that only adds a `theorem`/`lemma` with no code change to a non-`Thm/` definition) — those are correctness improvements but have no behavior to mutate.
2. **atomize** — one viable fix → one property + one Plausible test + a deterministic witness + a `patches/<variant>.patch`. Append a `[[tasks]]` group to `etna.toml`. **No git branch is created** — the patch is the durable artefact.
3. **runner** — populate `etna_cedar/Main.lean` (a `lake exe` target) that dispatches `<tool> <property>` programmatically. For Cedar's single-framework world this is `plausible <Property>` plus an `etna <Property>` mode that replays the witness.
4. **document** — generate `BUGS.md` + `TASKS.md` from `etna.toml`. The Rust workloads use `etna workload doc <dir>`; if that subcommand has no Lean awareness yet, regenerate via the equivalent Python helper at `etna-ify/skills/document/SKILL.md` (treat `lakefile.lean` and `Cedar/` as the language proxy for `Cargo.toml` and `src/`).
5. **validate** — `lake build Cedar` on base. Then for every variant: apply the patch in reverse (`git apply -R patches/<variant>.patch`) to install the bug, rebuild, run the witness `#test` (must fail), run `lake exe etna_cedar plausible <Property>` (must produce `{"status": "failed", ...}` within a 60 s budget). Then revert (`git apply patches/<variant>.patch`) and confirm the witness passes again.

## Pivots from the Rust pipeline

| Rust pipeline | Cedar (Lean 4) |
|---|---|
| `Cargo.toml`, `cargo build --release` | `lakefile.lean`, `lake build Cedar` |
| `src/bin/etna.rs` dispatcher | `etna_cedar/Main.lean` registered as a `lean_exe` target in `lakefile.lean` |
| `pub fn property_<name>(T) -> PropertyResult` | `def property_<name> : <T> → PropertyResult` (Lean), with `inductive PropertyResult \| pass \| fail (msg : String) \| discard` defined once at `Cedar/Etna/Property.lean` |
| `#[test] fn witness_<name>_case_<tag>` | `#test` block named `witness_<name>_case_<tag>` (Lean 4 `#test` macro), or a plain `def` returning `PropertyResult` plus a `#guard_msgs` assertion if `#test` is unavailable |
| `proptest`, `quickcheck`, `crabcheck`, `hegel` adapters | **`Plausible` only** (`leanprover-community/plausible`). The matrix collapses from 4 frameworks to 1; no `(tool, property)` orthogonality required beyond `etna` (witness replay) vs `plausible` (random) |
| Marauders comment syntax for localized injection | **patches only** — Lean has no marauders runtime. Use `git format-patch -1 <fix-sha>` to capture the fix; reverse-apply (`git apply -R`) at validate time to install the bug. |
| `etna workload check <dir>` enforces manifest+docs | If `etna2` lacks Lean support, use a local `scripts/check_lean_workload.py` that asserts the same invariants on `etna.toml` + `lakefile.lean` + `patches/` + `progress.jsonl`. |
| `quickcheck` fork at `…/quickcheck-rs` | `Plausible` from the lake registry (`require Plausible from git "https://github.com/leanprover-community/plausible" @ "main"`). |
| Pre-commit hook in `faultloc/scripts/workload_precommit.sh` | Same hook gets a Lean variant: `lake build Cedar` + `python scripts/check_lean_workload.py .` + the manifest/docs diff check. |

## Cedar-specific guidance

### What lives where in `cedar-lean/Cedar/`

- `Cedar/Spec/` — operational semantics: `Authorizer.lean`, `Evaluator.lean`, `Policy.lean`, `Value.lean`, etc. **Most behavior bugs land here.**
- `Cedar/Validation/` — type checker. Invariants like "validator accepts only well-typed policies" — fertile for properties.
- `Cedar/TPE/` — partial evaluator. Returns `Result.{ok, error}`; bugs of the form "TPE diverges from full evaluator on residual inputs" are excellent property candidates.
- `Cedar/SymCC/` and `Cedar/SymCCOpt/` — symbolic compiler. Equivalence between symbolic and concrete authorization is a top-tier property.
- `Cedar/Authorization/` and `Cedar/BatchedEvaluator/` — request/response evaluation pipeline. Sources of authorization bugs.
- `Cedar/Thm/` — pure proofs.
  - **As a source of new properties: read-only.** Don't synthesise an executable property whose only "test" is a statically-proved theorem — there is no random input to drive it.
  - **As patch contents: allowed.** A real fix often touches both the buggy definition (under `Spec/`/`Validation/`/etc.) and the proofs that mention it (under `Thm/`). The patch generated by `git format-patch` will include both, and reversing it must restore an internally-consistent buggy state where the (now-incorrect) proof typechecks.

### Property pattern

A Cedar property is a *concrete, executable* Lean function that returns `PropertyResult`. Most useful shapes:

- **Differential testing (Lean vs. Rust)** — the highest-value archetype for Cedar. Form: `property_validator_lean_eq_rust (schema : Schema) (policies : Policies) : PropertyResult` runs the Lean validator (in-process) and shells out to a pinned Rust `cedar-policy` binary, returns `Fail` on disagreement. The Rust-side oracle lives in `cedar-spec/cedar-drt/` and `cedar-spec/cedar-lean-cli/` — reuse the existing harness rather than reinventing it.
- **Equivalence between two Lean evaluators**: `property_authorize_eq_batch (req : Request) (env : Entities) (ps : Policies) : PropertyResult` — runs `Authorizer.isAuthorized` and `BatchedEvaluator.isAuthorized` and compares the `Decision`. Bugs in either implementation surface as `Fail`.
- **TPE soundness**: `property_tpe_residual_consistent` — TPE's residual on a concrete input must match full evaluation.
- **Validator monotonicity / preservation**: `property_validator_accepts_typecheck` — for any policy that the validator accepts, evaluation cannot reach a stuck state.
- **SymCC round-trip**: `property_symcc_models_match` — for a request and policies, the symbolic model agrees with the concrete authorizer.

The property must take **owned, totally-pure inputs** with `Plausible.Generators` instances. If Cedar lacks generators for the request/entities/policies types, write minimal ones in `Cedar/Etna/Generators.lean` — small bounded random `Entity`, `Request`, and one-or-two-policy `Policies` are enough; do not try to be representative of production traffic.

### Property-witness fidelity

The witness must distinguish base from buggy state. A common failure mode: the property checks a coarse invariant (e.g. "the validator returns Error") that is satisfied on the variant by *some other* code path that the patch didn't remove. Before declaring a witness done, you **must** run it twice:

1. On base (patch *not* applied) — witness returns `.pass`.
2. With the patch reverse-applied (`git apply -R patches/<variant>.patch`) — witness returns `.fail`.

If both runs return `.pass`, the property is too coarse for the bug. Sharpen it (target a finer invariant the patch's hunks specifically affect) before moving on. Witnesses that pass on the variant are silently broken — they make the workload look fine while quietly not finding the bug.

### Witness pattern

```lean
-- Cedar/Etna/Witnesses.lean
import Cedar.Etna.Property
import Cedar.Etna.Generators

def witness_authorize_eq_batch_case_minimal_deny : PropertyResult :=
  property_authorize_eq_batch
    { principal := ... , action := ... , resource := ... , context := ... }
    Entities.empty
    [denyAll]

#test witness_authorize_eq_batch_case_minimal_deny == .pass
```

### Mutation injection — patch-only, no branches

There is no marauders for Lean, and we do not maintain `etna/<variant>` branches. Every variant is a single artefact: `patches/<variant>.patch`, generated as the verbatim output of `git format-patch -1 <fix-sha>`. Concretely:

```sh
# Generate the bug-injecting patch from a fix commit
git -C .cedar-spec format-patch -1 "$FIX_SHA" --stdout > patches/"$variant".patch
# At validation/test time, apply *in reverse* to remove the fix and reintroduce the bug
git -C .cedar-spec apply -R --whitespace=nowarn patches/"$variant".patch
# After running tests
git -C .cedar-spec apply --whitespace=nowarn patches/"$variant".patch  # restore
```

The base state of the workload (the working tree on `main`/`HEAD` of `.cedar-spec`) always contains the fix. The patch records the diff between base (fixed) and variant (buggy); reversing it produces the buggy state. No git branches required — no per-variant state to keep in sync, no rebase headaches when the runner stub changes.

### Runner stub

`etna_cedar/Main.lean`:

```lean
import Cedar.Etna.Property
import Cedar.Etna.Witnesses
import Plausible

def main (args : List String) : IO UInt32 := do
  match args with
  | ["etna", "AuthorizeEqBatch"] => emitJson (witness_authorize_eq_batch_case_minimal_deny)
  | ["plausible", "AuthorizeEqBatch"] =>
      let r ← Plausible.Testable.runSuite (fun req env ps => property_authorize_eq_batch req env ps).map propResultToBool
      emitJson r
  | _ => IO.println "{\"status\":\"aborted\",\"error\":\"unknown args\"}"; pure 0
```

Output contract is **identical** to the Rust pipeline: one JSON line per invocation with `{status, tests, time, counterexample, error}`, exit 0 except for argv parse errors. Etna's `log_process_output` reads JSON, not exit codes.

The runner artefacts (`Cedar/Etna/Property.lean`, `Cedar/Etna/Properties.lean`, `Cedar/Etna/Witnesses.lean`, `etna_cedar/Main.lean`, and the `lean_exe etna_cedar` declaration in `lakefile.lean`) are part of the *base* state — they must be committed on the upstream tree before any patches are applied so that reverse-applying a patch leaves them intact. **Do not leave them as untracked files.**

### Build flags

`-C instrument-coverage` does not exist in Lean. Coverage-instrumented faultloc is **out of scope** for this prompt. The Lean workload aims at framework-comparison + reproducibility, not SBFL. If we later want SBFL we'll ship a separate Lean-tailored coverage capture (Lean's `--profile`-style instrumentation) — flag in TASKS.md but do not implement here.

## Source-of-truth invariants (Lean variant)

- `etna.toml` is the only hand-maintained index. `[[tasks]]` schema as in the Rust pipeline; `[tasks.injection]` only ever has `kind = "patch"`.
- `Cedar/Etna/Property.lean` defines `PropertyResult` and the `propResultToBool` helper.
- `Cedar/Etna/Witnesses.lean` holds every `witness_*` `#test`.
- `Cedar/Etna/Generators.lean` holds Plausible `Generators` instances for Cedar types.
- `lakefile.lean` declares the `etna_cedar` `lean_exe` target, the `Plausible` dependency, and `lean_lib Cedar.Etna`.
- `patches/<variant>.patch` is the verbatim output of `git format-patch -1 <fix-sha>`.
- `progress.jsonl` is appended at every stage boundary (same contract as `run.md`).

## Progress logging

Identical to `run.md` — append one JSON line per event to `<project>/progress.jsonl`. Stage names are unchanged: `discover`, `atomize`, `runner`, `document`, `validate`. Add Cedar-specific events:

- `discover.event = subtree_filtered` with `paths_kept = N`, `paths_dropped = M`.
- `atomize.event = property_synthesized` with `property = "AuthorizeEqBatch"`, `category = "spec_equivalence" | "tpe_soundness" | "validator_invariant" | "symcc_roundtrip"`.
- `runner.event = lean_exe_built`, `target = "etna_cedar"`.

Use the same shell helper as `run.md` (set `PROJECT=workloads/Lean/Cedar`).

### Discover stage filter, refined

When walking `git log --all`, give priority to merges from PRs whose title or body matches `differential` / `DRT` / `Lean.*Rust` / `Rust.*Lean` / `validator divergence` — those are the differential bugs that motivate the workload. The filter is a *priority*, not an exclusion: still keep ordinary localized fixes (e.g. a `TPE` arithmetic bug) as they make excellent secondary variants.

`cedar-spec` PR merge commits are conventionally squash-merged with subjects like `Make X do Y (#NNN)`. Use `git log --grep='(#[0-9]\+)$' --pretty='%H %s'` to enumerate them and `gh pr view <N> --repo cedar-policy/cedar-spec` to fetch each PR's metadata if more context is needed.

## Property & generator discipline (REQUIRED reading)

Before writing any property or generator, read
`etna-ify/prompts/property-discipline.md`. It is the single source of truth
for:

1. **Hughes' 5-category property synthesis priority** (model-based >
   postcondition > metamorphic > algebraic > inductive). Pick the
   highest-priority category that fits; never encode the bug shape
   inside the property body or precondition.
2. **Library-faithful generator rule.** Use the project's own
   `Plausible.Sampleable` / `SampleableExt` instances directly. If none
   exist, generate at the natural type. Encode preconditions inside the
   property body via `Plausible.Decide` `discard` semantics, never by
   narrowing the generator.
3. **Drop rule.** If no Hughes category yields a bug-independent property,
   drop the variant — do NOT invent a regression-pinning assertion.
4. **Two-property rule.** Aim for ≥2 properties per variant from different
   Hughes categories.
5. **Validation gate.** Bug-trigger rate of the generator must be in
   (0.001, 0.80) — not bug-biased, but reachable.

For Cedar/Lean workloads specifically:
- **Model-based is the strongest category** for this corpus because Cedar
  has a Rust reference implementation. Differential properties between the
  Lean spec and the Rust engine are the canonical model-based property
  shape. Use them whenever the bug touches semantics shared with Rust.
- For **postcondition** properties, the Cedar invariants are the
  validator's well-formedness guarantees: `validate p s = .ok () ⇒
  ∀ req. eval p s req = .allow ∨ .deny ∨ documented-error`. This is the
  type-safety / soundness theorem and applies broadly.
- For **metamorphic**, prefer encoder/decoder round-trips paired with a
  postcondition (Hughes' warning about plain round-trip applies in full
  for SymCC encoders).
- The hand-curated Cedar workload's properties — especially
  `property_validator_type_preservation` and
  `property_symcc_pipeline_soundness` — are the gold-standard examples
  and were classified `mirrored + general` in the audit. Mimic their
  shape.
- Properties that the docstring openly labels "unit-test-style" (e.g.
  `ValidateWithLevelAccepts`) are the explicit drop-or-pin cases — the
  audit flags them as `vacuous + narrow`. Don't introduce new ones; if a
  bug is only observable as a single-fixture witness, drop the variant.

## Non-negotiables

- **Patches only.** No marauders, no in-source `M_<variant>=active` toggles, **and no `etna/<variant>` git branches.** The patch is the variant; nothing else.
- **Plausible only.** No multi-framework parity. The `tool` axis collapses to `{etna, plausible}`.
- **`lake build Cedar` must pass on base AND with the patch reverse-applied.** A variant whose buggy state breaks the build is rejected — it represents a fix the Lean elaborator forced to be load-bearing, not a behavior bug.
- **Witnesses must distinguish.** Run every witness twice (base, then patch reversed) and confirm `.pass` then `.fail`. A witness that passes on the buggy state is silently broken; reject the variant or sharpen the property until it discriminates.
- **Property functions are pure and total.** No `IO`, no `partial def`, no `unsafe_*`. The invariant is that calling it twice with the same input gives the same `PropertyResult`.
- **Witnesses use only `#test` (or `#guard_msgs` plus a `def`)**, never Plausible — witnesses replay frozen inputs.
- **Runner artefacts live on the base tree.** `Cedar/Etna/`, `etna_cedar/`, and the `lakefile.lean` `lean_exe etna_cedar` declaration must all be committed on the upstream working tree (`main`/`HEAD`). Untracked-file workflows break under any branch switch or `git stash`.
- **Property name is PascalCase in the manifest, snake_case in source.** `property = "AuthorizeEqBatch"` ↔ `def property_authorize_eq_batch`. The mapping is identical to `pascal_to_snake` from `etna2/src/commands/workload/check.rs:307`.
- **Single Lean-toolchain commit.** Pin `lean-toolchain` to whatever cedar-lean shipped with at the chosen `base_commit`; do **not** bump it during atomize even if a variant happens to fail under the pinned toolchain. Record the issue under `[[dropped]]` instead.
- **No checkpoint JSONs.** `etna.toml`, `Cedar/Etna/`, and `patches/` are the only durable state. `progress.jsonl` is per-run scratch.

## Project: $1

$@
