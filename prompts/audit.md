---
description: Audit an existing ETNA workload for vacuous bugs / properties / generators / witnesses
---

# ETNA Workload Audit

Audit the workload at `$1` for methodological flaws. Output a stream of
JSON objects (one per variant) describing whether each variant's bug,
property, generator, and witnesses are real-mirrored / derived /
vacuous / hallucinated. The user reviews the output offline.

## Arguments

- `$1` — absolute path to a workload directory containing `etna.toml`
  (e.g. `workloads/Haskell/network-uri`,
  `workloads/Rust/regex-syntax`, `workloads/Python/iso8601`,
  `workloads/Lean/Cedar`).

## Strict output contract

This is an unattended audit. Every line of stdout must be either:

- A single-line JSON object beginning with `{` (one per variant), or
- Exactly one of the sentinel lines:
  - `AUDIT_DONE workload=<name> variants=<N>`
  - `AUDIT_ABANDON workload=<name> reason=<short reason>`

Do **not** print any prose, headers, markdown, debug dumps, or partial
JSON. Tool calls are fine; only their text output to your reply matters.

If you cannot complete the audit (etna.toml malformed, upstream remote
unreachable, source files missing), emit `AUDIT_ABANDON` and stop.

## Step-by-step

### 0. Read the manifest

Open `$1/etna.toml`. Record:

- `name` — used in JSON output as `workload`.
- `language` — `rust` | `python` | `haskell` | `lean`. Selects per-language
  paths in subsequent steps.
- The list of `[[tasks]]` blocks. Each block has `mutations`, `source`,
  `injection`, `bug`, and one or more `[[tasks.tasks]]` sub-blocks.

### 1. Per language, learn where to look

Per-language source paths (apply throughout):

| Aspect | Rust | Python | Haskell | Lean |
|---|---|---|---|---|
| Property defs (workload) | `src/bin/etna.rs` or `src/etna.rs` (`pub fn property_<snake>`) | `etna/etna_runner/properties.py` | `etna/src/Etna/Properties.hs` | `<pkg>/Etna/Properties.lean` |
| Generators (workload) | inline in `src/bin/etna.rs` (`impl CcArbitrary` / `Strategy`) | `etna/etna_runner/strategies.py` | `etna/src/Etna/Gens/QuickCheck.hs` | `<pkg>/Etna/Gens/...` |
| Witnesses (workload) | `src/bin/etna.rs` (`fn witness_<snake>_case_<tag>`) or sibling `#[test] fn witness_*` | `etna/etna_runner/witnesses.py` | `etna/src/Etna/Witnesses.hs` | `<pkg>/Etna/Witnesses.lean` |
| Upstream tests | `tests/`, `src/**/tests.rs`, `*_test.rs`; macros: `proptest!`, `#[quickcheck]`, `#[test] fn` | `tests/`, `test/`, `tests_*.py`, `conftest.py`; decorators: `@given`, `@hypothesis.given` | `test/`, `tests/`, `src/Test/`; modules importing `Test.QuickCheck`, `Hedgehog`, `Test.Falsify`, `Test.SmallCheck` | `<pkg>/Tests/`, `Test/`, `*Tests*.lean`; `theorem`/`example` clauses, `Plausible.Testable`, `slim_check` |
| Upstream generators | `Arbitrary` / proptest `Strategy` impls; `prop_compose!`; `#[derive(Arbitrary)]` | `hypothesis.strategies.*` calls; `@composite` strategies | `Arbitrary <T>`/`Gen <T>` instances; `genericArbitrary` | `Gen <T>`; `SampleableExt`; `Plausible.Sampleable` |

### 2. For each `[[tasks]]` block

Repeat steps A–D for each block. One block = one variant (the
`mutations` field has 1 entry; if more than 1, treat each separately).

#### A. Bug verification

1. Take `tasks.source.commits[0]` — the SHA the agent claimed.
2. In `$1`: ensure remotes are fetched. Try in order:
   - `git -C "$1" fetch upstream` (if `upstream` remote exists).
   - `git -C "$1" fetch origin` otherwise.
   - If neither works, fall back to `gh api repos/<owner>/<repo>/commits/<SHA>`
     where the repo URL comes from `tasks.source.repo`.
3. `git -C "$1" show --stat <SHA>` to inspect the upstream commit.
4. Read the upstream commit message and diff. Compare against:
   - `bug.summary` and `bug.short_name` in etna.toml,
   - `tasks.source.commit_subjects` (the agent's quoted subject),
   - `patches/<variant>.patch` (the actual injection).

5. Classify `bug_class`:
   - `real-mirrored` — commit fixes exactly what `bug.summary` says, and
     `patches/<variant>.patch` is a near-reversal of the same hunks
     (same files, overlapping line ranges, same logical change).
   - `real-narrowed` — commit fixes a real bug, but the patch reverses
     a strict subset / adjacent region. Acceptable if `tasks.bug` makes
     that clear; flag if not.
   - `synthetic-disclosed` — `tasks.source.origin == "internal"` AND
     either `bug.summary` or `tasks.source` notes that the patch is
     synthesized (look for words like "synthetic", "hand-craft",
     "in the spirit of", "modern HEAD"). The bug class exists in
     upstream history but this particular patch was hand-written.
   - `hallucinated` — the commit doesn't relate to the described bug
     and etna.toml does not disclose synthesis. The agent invented a
     commit-bug link that isn't real.

6. Write a 1-sentence `bug_reason` quoting the commit message subject
   and the etna.toml claim, and saying why they match (or don't).

#### B. Property classification

1. Read `property_<snake>` from the per-language path above. Note its
   precondition (if any) and its assertion.
2. Search the upstream test suite at TWO levels:
   - **Specific match**: any property that mentions the variant's
     operation by name (e.g. `prop_count`, `prop_singularize`).
   - **Umbrella match (CRITICAL — most common miss)**: any
     property/test that asserts a *broad* invariant which would COVER
     the variant's bug, even if it doesn't mention the specific
     bug-token. Examples to look for:
     * `prop_read_ppShow x = read (ppShow x) == x` — covers any
       parser/printer round-trip bug for any input shape `x`'s type
       can produce.
     * `prop_encode_decode_inv` / `prop_round_trip` — covers any
       encoding bug.
     * `prop_invariant` / `wf` / `valid` — covers any structural-
       invariant bug.
     * `quickcheck_test_property` calling `quickcheck!` over the
       library's full input space — covers everything reachable.
   - Open the test file. If the *type* the umbrella property
     quantifies over (`D`, `D2`, `Arbitrary T`) can produce inputs
     that exhibit the variant's bug shape, that umbrella property
     mirrors/covers the variant.
3. Classify `property_class`:
   - `mirrored` — upstream has a PBT property test (random/Hedgehog/
     Hypothesis/proptest) — either specific OR umbrella — that asserts
     the same invariant on inputs reaching the variant's operation.
     Cite
     `<file>:<line>` in `property_upstream_ref`.
   - `derived` — no upstream PBT test, BUT the invariant is documented
     in upstream haddock / docstring / RFC / README or implied by
     the function's documented contract. Explain the derivation in
     `property_reason`. Cite the doc location in
     `property_upstream_ref`.
   - `vacuous` — no upstream PBT and no documented invariant. The
     property was invented to fit the bug. Set
     `property_upstream_ref` to `null`.

#### C. Generator classification

1. Read `gen_<snake>` (or `strategy_<snake>` for Python, the equivalent
   `CcArbitrary` impl for Rust, `Gen <type>` for Lean). Note the
   distribution: bounds, character sets, length ranges, special
   structural constraints.
2. Search upstream for any `Arbitrary`, `Gen`, `Strategy`, or
   `hypothesis.strategies.*` that produces the input type. Compare
   distributions:
3. Classify `generator_class`:
   - `mirrored` — upstream has a generator with similar distribution
     (same type, same bounds within 2x, same structural constraints).
     Cite.
   - `derived` — upstream has a generator for a related type. The
     workload's is a clear restriction or extension. Explain.
   - `vacuous` — no upstream generator analog AND the workload's
     generator is narrowed specifically to bug-triggering inputs
     (e.g. always produces a regex pattern that hits the buggy
     case, or always produces strings of length 1 to dodge a buffer
     bug). Set `generator_upstream_ref` to `null`.

#### D. Witness shape

1. Find every witness referenced by this variant's `[[tasks.tasks]]`
   `witnesses[].test_fn` field.
2. Read each one in the per-language witnesses file.
3. Each must be the simple form:
   - Haskell: `witness_<snake>_case_<tag> = property_<snake> <args>`
   - Python: `def witness_<snake>_case_<tag>(): return property_<snake>(<args>)`
   - Rust: `pub fn witness_<snake>_case_<tag>() -> PropertyResult { property_<snake>(<args>) }` (one expression, no `if`/`let` chains beyond binding the args)
   - Lean: `def witness_<snake>_case_<tag> : PropertyResult := property_<snake> <args>`
4. Set `witness_simple = true` if every witness for this variant
   matches the simple form. Otherwise `false`, and add the offending
   names to `witness_violations`.

### 3. Emit one JSON object per variant

Print the object on its own single line. Format:

```
{"workload":"<name>","language":"<lang>","variant":"<variant>","bug_class":"<class>","bug_reason":"<reason>","property":"<PropertyPascalCase>","property_class":"<class>","property_reason":"<reason>","property_upstream_ref":"<file:line>" or null,"generator_class":"<class>","generator_reason":"<reason>","generator_upstream_ref":"<file:line>" or null,"witness_simple":<bool>,"witness_violations":[],"audit_ts":"<ISO8601 UTC>"}
```

Use `python3 -c "import json,sys;print(json.dumps({...}))"` if you need
to safely escape strings (long reasons may contain quotes).

### 4. Sentinel

Once all variants are emitted, print on its own line:

```
AUDIT_DONE workload=<name> variants=<N>
```

If you hit an unrecoverable error before all variants are emitted, print:

```
AUDIT_ABANDON workload=<name> reason=<one-line reason>
```

## Notes for the agent

- **Read-only.** Do not modify any file in the workload, do not commit,
  do not push. Use `git fetch` (read-only) but no other write ops.
- **Be precise but terse.** `bug_reason`, `property_reason`,
  `generator_reason` are 1–2 sentences each. Cite exact file:line for
  upstream refs.
- **Default to skepticism** for vacuous classifications. If you can't
  find an upstream test in 3–4 minutes of searching, say `vacuous`
  rather than guessing.
- **Do not infer "mirrored" from haddock/docstring alone.** Mirrored
  requires a PBT test (something with a random generator). Doc-only
  invariants are `derived`.
- **When etna.toml's bug.summary mentions "synthetic", "hand-craft",
  or "in the spirit of"** — that's `synthetic-disclosed`, not
  `hallucinated`. The pipeline supports synthetic patches when
  upstream API has drifted.

## Project: $1

$@
