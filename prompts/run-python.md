---
description: Build an ETNA workload from a Python project by mining its git history (Hypothesis + CrossHair backends)
---

# ETNA Workload Generation — Python (Hypothesis / CrossHair)

Mine the git history of a Python library, turn every viable bug fix into a
mutation+property+witness triplet driven by Hypothesis (random-search backend)
and CrossHair (symbolic backend, via the `hypothesis-crosshair` plugin), and
ship it as an ETNA workload at `workloads/Python/<name>`.

This is the Python analogue of `prompts/run.md` (Rust) and `prompts/run-cedar.md`
(Lean). Five stages, no checkpoint JSONs, `etna.toml` is the source of truth.
**Read this file end-to-end before starting**; the pivots from the Rust pipeline
are non-trivial.

## Arguments

- `$1` — workload directory (e.g. `workloads/Python/sortedcontainers`). Must
  already be a git working tree containing the upstream library (a fork
  cloned from the canonical repo). The workload directory **is** the upstream
  fork — patches apply against the upstream sources directly. Convention from
  `project_etna_fork_convention`: push to `alpaylan/<dir>-etna`, `origin=fork`,
  `upstream=real`.

## Pipeline

```
discover  ->  atomize  ->  runner  ->  document  ->  validate
```

Run them in order. The skill files in `etna-ify/skills/<stage>/SKILL.md`
describe Rust mechanics; the Python deltas in this file override them.

1. **discover** — `git log --all --pretty=format:'%H%x00%ai%x00%s'` over the
   upstream fork. Keep every commit whose subject matches the fix taxonomy
   (see Discover deltas below) **and** whose diff touches the library's
   importable Python source (typically under `<libname>/`, `src/<libname>/`,
   or top-level `*.py`). Drop pure-test/pure-doc commits and commits whose
   only change is in C extensions or Cython sources — CrossHair cannot reason
   about non-Python code, and we want both backends to be applicable.
2. **atomize** — one viable fix → one property + one witness + one
   `patches/<variant>.patch` + one `[[tasks]]` group in `etna.toml`. **No
   marauders, no in-source markers, no per-variant git branches.** The patch
   is the durable variant artefact.
3. **runner** — populate `etna/etna_runner/runner.py` with a CLI that dispatches
   `<tool> <property>` programmatically. Tools: `etna` (witness replay),
   `hypothesis` (default backend), `crosshair` (Hypothesis with
   `backend="crosshair"`). The runner is a single Python entrypoint installed
   as a console script via `etna/pyproject.toml`.
4. **document** — generate `BUGS.md` + `TASKS.md` from `etna.toml`. Try
   `etna workload doc <dir>` first; if it rejects `language = "python"`, fall
   back to `python scripts/check_python_workload.py <dir> --regen-docs`.
5. **validate** — base passes the witness for every property under both
   `hypothesis` and `crosshair`. Then for each variant: reverse-apply the
   patch, confirm every witness `.fail`s, confirm `hypothesis` finds a
   counterexample within budget, confirm `crosshair` either finds a
   counterexample or times out (timeout is acceptable for crosshair — record
   it in the manifest as `crosshair_timeout = true` for that variant rather
   than dropping the whole variant). Restore the patch. Run
   `python scripts/check_python_workload.py <dir>` to verify manifest/source
   consistency.

## Pivots from the Rust pipeline

| Rust pipeline | Python (Hypothesis + CrossHair) |
|---|---|
| `Cargo.toml`, `cargo build --release` | `pyproject.toml` at workload root (upstream's, untouched) + `etna/pyproject.toml` (ours, depends on parent in editable mode); env via `uv`. |
| `src/bin/etna.rs` dispatcher | `etna/etna_runner/runner.py` (one Python file, console-script entry). |
| `pub fn property_<name>(T) -> PropertyResult` | `def property_<name>(args) -> PropertyResult` in `etna/etna_runner/properties.py`. `PropertyResult` is `Pass` / `Fail(msg: str)` / `Discard`, defined in `etna/etna_runner/_result.py` as a `dataclass` hierarchy or a `typing.Literal` enum. |
| `#[test] fn witness_<name>_case_<tag>` | `def witness_<name>_case_<tag>() -> PropertyResult` in `etna/etna_runner/witnesses.py`. Plain function. Pytest-discoverable via `etna/tests/test_witnesses.py` which iterates and asserts `is_pass`. |
| `proptest`, `quickcheck`, `crabcheck`, `hegel` adapters | **`hypothesis` and `crosshair` only.** Same `@given(strategy_<name>())` test, dispatched twice with `settings(backend=...)`. Strategies live in `etna/etna_runner/strategies.py`, one `def strategy_<name>() -> SearchStrategy[...]` per property. |
| Marauders comment syntax | **Patches only.** Same as Cedar: `git format-patch -1 <fix-sha>` against the upstream fork. Reverse-apply at validate time, restore after. |
| `etna workload check <dir>` | `python scripts/check_python_workload.py <dir>` — same invariant set: manifest parses, every variant has a patch, every patch applies cleanly, every property/witness exists as a callable, witnesses pass on base and fail on reversed patch, docs match. |
| `quickcheck` fork at `…/quickcheck-rs` | Stock `hypothesis` from PyPI, plus `hypothesis-crosshair` from PyPI for the symbolic backend. Pin both in `etna/pyproject.toml`. |
| Pre-commit hook in `faultloc/scripts/workload_precommit.sh` | New sibling `faultloc/scripts/workload_precommit_python.sh` that runs `python scripts/check_python_workload.py .` plus `uv run pytest etna/tests/test_witnesses.py` on staged Python workloads. |

## Workload directory layout

```
workloads/Python/<name>/                       # the upstream fork; do not edit upstream files
  <upstream files...>                          # untouched
  etna.toml                                    # ours — the manifest (single source of truth)
  patches/<variant>.patch                      # ours — bug-injection patches
  etna/                                        # ours — uv project root for the runner
    pyproject.toml                             # ours — uv project; deps on parent + hypothesis + hypothesis-crosshair + pytest
    etna_runner/                               # the runner package (this is what gets installed)
      __init__.py
      _result.py                               # PropertyResult definition
      properties.py                            # property_<snake>() functions, plain Python
      strategies.py                            # strategy_<snake>() Hypothesis SearchStrategy builders
      witnesses.py                             # witness_<snake>_case_<tag>() functions
      runner.py                                # CLI dispatcher; entry point: `etna-runner <tool> <property>`
    tests/
      __init__.py
      test_witnesses.py                        # pytest collector for witnesses (base sanity)
      test_property_<name>.py                  # one per property — `@given(strategy_<name>())` test
  progress.jsonl                               # generated; gitignored
  .hegel/                                      # gitignored if any tool uses it
  BUGS.md                                      # generated, do not hand-edit
  TASKS.md                                     # generated, do not hand-edit
  README.md                                    # workload-specific README; describes the upstream + how to run
  marauder.toml                                # output of `marauders init --language python` (kept for parity; unused)
```

The upstream library remains importable as-is (e.g. `from sortedcontainers import SortedList`). Patches apply against upstream sources at their normal paths — the patch's `--- a/<libname>/foo.py` headers refer to the workload root.

`etna/pyproject.toml` should look approximately like:

```toml
[project]
name = "etna-runner"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
  "hypothesis>=6.115",
  "hypothesis-crosshair>=0.0.20",
  "crosshair-tool>=0.0.79",
  "pytest>=8",
]

[project.scripts]
etna-runner = "etna_runner.runner:main"

[tool.uv.sources]
# Install the upstream library in editable mode from the workload root.
<libname> = { path = "..", editable = true }

[tool.hatch.build.targets.wheel]
packages = ["etna_runner"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

The runner is invoked from inside `etna/` as `uv run etna-runner <tool> <property>` (or `uv run python -m etna_runner.runner <tool> <property>` if the console-script form is unavailable). The runner must satisfy the etna JSON-on-stdout contract (see Output below) and exit 0 except on argv-parse error.

## Property & generator discipline (REQUIRED reading)

Before writing any property or strategy, read
`etna-ify/prompts/property-discipline.md`. It is the single source of truth
for:

1. **Hughes' 5-category property synthesis priority** (model-based >
   postcondition > metamorphic > algebraic > inductive). Pick the
   highest-priority category that fits; never encode the bug shape
   inside the property body or precondition.
2. **Library-faithful strategy rule.** Use the upstream's own
   `hypothesis.strategies.*` invocations directly. If none exist,
   generate at the natural type with `st.integers()` / `st.text()` /
   `st.lists()` / `st.from_type()`. Encode preconditions in the property
   body via `PropertyResult.Discard`, never by narrowing the strategy.
3. **Drop rule.** If no Hughes category yields a bug-independent property,
   drop the variant — do NOT invent a regression-pinning assertion.
4. **Two-property rule.** Aim for ≥2 properties per variant from different
   Hughes categories.
5. **Validation gate.** Bug-trigger rate of the strategy must be in
   (0.001, 0.80) — not bug-biased, but reachable.

For Python workloads specifically:
- The reference impl for **model-based** is often a stdlib counterpart:
  `collections.OrderedDict` for ordered map libs, `re` for regex libs,
  `datetime` for datetime libs. Compare specialized impl against stdlib
  on overlapping inputs.
- **CrossHair compatibility** prefers simple strategies (`st.integers`,
  `st.text`, `st.lists`, `st.tuples`, `st.from_type`). Avoid `@composite`
  strategies that branch on intermediate Hypothesis state — CrossHair
  will time out symbolically. The library-faithful rule helps here:
  using upstream's own `from_type` keeps generators CrossHair-compatible.
- For **no-panics**, wrap `f(x)` in `try / except Exception` inside the
  property; assert no exception (or only the documented exception type).
- The legacy `etna-haskell-bst` workload (Haskell, but the property
  patterns translate verbatim to Python) is the canonical Hughes example.
  Mimic its 5-category structure.

## Property contract

```python
# etna/etna_runner/_result.py
from dataclasses import dataclass

@dataclass(frozen=True)
class PropertyResult:
    kind: str  # "pass" | "fail" | "discard"
    message: str = ""

PASS = PropertyResult("pass")
DISCARD = PropertyResult("discard")
def fail(msg: str) -> PropertyResult: return PropertyResult("fail", msg)
```

```python
# etna/etna_runner/properties.py
from <libname> import ...
from ._result import PropertyResult, PASS, DISCARD, fail

def property_<snake>(args) -> PropertyResult:
    """Pure, total. No I/O, no clock, no randomness."""
    ...
    if invariant_holds: return PASS
    return fail(f"({args!r}): expected X got Y")
```

Properties take a single tuple/dataclass `args` parameter (or unpack to multiple positional args — must match what the strategy generates). Pure, deterministic, no global state, no `time.time()`, no `random.*`.

## Strategy contract

```python
# etna/etna_runner/strategies.py
from hypothesis import strategies as st

def strategy_<snake>():
    return st.tuples(st.integers(...), st.text(...))  # whatever the property takes
```

Strategies must be CrossHair-compatible: stick to `st.integers`, `st.text`,
`st.lists`, `st.tuples`, `st.booleans`, `st.from_type`, `st.builds`,
`st.one_of`. Avoid `st.randoms`, `st.data`, custom `@composite` strategies
that branch on intermediate Hypothesis state, and any strategy producing
unhashable / non-Picklable values (CrossHair walks them through Z3 and trips
on opaque objects). When in doubt, prefer the simpler strategy and let
CrossHair time out on tricky cases — a `crosshair_timeout` annotation on the
variant is fine.

## Witness contract

```python
# etna/etna_runner/witnesses.py
from .properties import property_<snake>
from ._result import PropertyResult

def witness_<snake>_case_<tag>() -> PropertyResult:
    return property_<snake>(<frozen args>)

# pytest collection in etna/tests/test_witnesses.py:
import pytest
from etna_runner.witnesses import witness_<snake>_case_<tag>

def test_witness_<snake>_case_<tag>():
    r = witness_<snake>_case_<tag>()
    assert r.kind == "pass", r.message
```

A witness is a plain function with no parameters, no decorators, no
randomness. It calls the property with frozen inputs that — on a base tree —
return `PASS`, and on a tree with the bug reintroduced (patch reverse-applied)
return `fail(...)`. The fidelity check (run on base ⇒ pass; run with patch
reversed ⇒ fail) is mandatory before declaring a variant done. See "Property
fidelity check" below.

## Hypothesis test contract (per property)

```python
# etna/tests/test_property_<snake>.py
from hypothesis import given, settings
from etna_runner.properties import property_<snake>
from etna_runner.strategies import strategy_<snake>

@given(strategy_<snake>())
@settings(max_examples=200, deadline=None)
def test_property_<snake>(args):
    r = property_<snake>(args)
    assert r.kind != "fail", r.message
```

The runner imports this test function and re-decorates it with the requested
backend at dispatch time:

```python
# inside etna/etna_runner/runner.py
from hypothesis import settings, HealthCheck
from hypothesis.errors import InvalidArgument

def _drive(prop_test, backend: str, max_examples: int):
    cfg = settings(backend=backend, max_examples=max_examples,
                   deadline=None, derandomize=False,
                   suppress_health_check=list(HealthCheck))
    return cfg(prop_test)
```

Backends:
- `"hypothesis"` (default backend; random + shrinking)
- `"crosshair"` (requires `hypothesis-crosshair` installed and `crosshair`
  on `PATH`; symbolic execution)

## Mutation injection — patch-only, no branches

Identical mechanics to Cedar:

```sh
git -C "$WORKLOAD" format-patch -1 "$FIX_SHA" --stdout > patches/"$variant".patch
# At validate / test time:
git -C "$WORKLOAD" apply -R --whitespace=nowarn patches/"$variant".patch     # install bug
# ...run tests...
git -C "$WORKLOAD" apply --whitespace=nowarn patches/"$variant".patch        # restore base
```

The base tree always contains the fix; the patch records the diff between
fixed (base) and buggy (variant). Reversing the patch produces the buggy
state. No per-variant branches.

If `git format-patch` produces a patch that no longer applies (API drift —
the file moved, was renamed, or a neighboring hunk evolved), hand-craft the
patch against modern `HEAD`. Store it under `patches/<variant>.patch` in the
same git-format-patch shape. See `project_lean_patch_synthesis` for the same
pattern in the Lean pipeline.

## Runner stub (`etna/etna_runner/runner.py`)

```python
"""ETNA runner for Python workloads.

Dispatches `<tool> <property>` programmatically. Emits a single JSON line on
stdout per invocation; always exits 0 except on argv-parse errors.
"""
import argparse
import json
import os
import sys
import time
from typing import Any

from hypothesis import settings, HealthCheck
from hypothesis.errors import HypothesisException, MultipleFailures

# Property/witness modules live in the same package.
from . import properties  # property_<snake>
from . import strategies  # strategy_<snake>
from . import witnesses   # witness_<snake>_case_<tag>

ALL_PROPERTIES = ["<Prop1>", "<Prop2>", ...]  # PascalCase names matching etna.toml

def _emit(tool: str, prop: str, status: str, tests: int, time_us: int,
          counterexample: str | None = None, error: str | None = None) -> None:
    sys.stdout.write(json.dumps({
        "status": status, "tests": tests, "discards": 0,
        "time": f"{time_us}us",
        "counterexample": counterexample, "error": error,
        "tool": tool, "property": prop,
    }) + "\n")
    sys.stdout.flush()

def _pascal_to_snake(s: str) -> str:
    out = []
    for i, c in enumerate(s):
        if c.isupper() and i and not s[i-1].isupper():
            out.append("_")
        out.append(c.lower())
    return "".join(out)

def _run_witness(prop: str) -> tuple[str, int, str | None]:
    """Tool=etna: replay every witness for `prop` once."""
    snake = _pascal_to_snake(prop)
    fns = [getattr(witnesses, n) for n in dir(witnesses)
           if n.startswith(f"witness_{snake}_case_")]
    if not fns:
        return ("aborted", 0, f"no witnesses for {prop}")
    for fn in fns:
        r = fn()
        if r.kind == "fail":
            return ("failed", 1, r.message)
    return ("passed", len(fns), None)

def _run_hypothesis(prop: str, backend: str, max_examples: int = 200):
    snake = _pascal_to_snake(prop)
    strat = getattr(strategies, f"strategy_{snake}")()
    prop_fn = getattr(properties, f"property_{snake}")
    counter = {"n": 0}
    counterexample: list[str | None] = [None]

    def _wrapped(args):
        counter["n"] += 1
        r = prop_fn(args)
        if r.kind == "fail":
            counterexample[0] = f"({args!r})"
            assert False, r.message
        # Pass / Discard both okay for hypothesis (return None).

    from hypothesis import given
    test = given(strat)(_wrapped)
    test = settings(
        backend=backend, max_examples=max_examples,
        deadline=None, derandomize=False,
        suppress_health_check=list(HealthCheck),
    )(test)

    try:
        test()
        return ("passed", counter["n"], None, None)
    except AssertionError as e:
        return ("failed", counter["n"], counterexample[0] or "<unknown>", None)
    except (HypothesisException, MultipleFailures) as e:
        return ("failed", counter["n"], counterexample[0] or "<unknown>", str(e))
    except Exception as e:
        # Library panic etc.
        return ("failed", counter["n"], counterexample[0] or "<unknown>", f"{type(e).__name__}: {e}")

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("tool", choices=["etna", "hypothesis", "crosshair"])
    p.add_argument("property")
    p.add_argument("--max-examples", type=int, default=200)
    args = p.parse_args(argv)

    targets = ALL_PROPERTIES if args.property == "All" else [args.property]
    overall_status = "passed"
    total_tests = 0
    t0 = time.perf_counter()

    for prop in targets:
        if prop not in ALL_PROPERTIES:
            _emit(args.tool, prop, "aborted", 0, 0, None, f"unknown property: {prop}")
            return 0  # exit 0 even on unknown — etna reads JSON
        if args.tool == "etna":
            status, tests, err = _run_witness(prop)
            cex = err if status == "failed" else None
            _emit(args.tool, prop, status, tests,
                  int((time.perf_counter() - t0) * 1e6), cex, None)
            total_tests += tests
        else:
            backend = "crosshair" if args.tool == "crosshair" else "hypothesis"
            try:
                status, tests, cex, err = _run_hypothesis(prop, backend, args.max_examples)
            except Exception as e:
                status, tests, cex, err = "aborted", 0, None, f"{type(e).__name__}: {e}"
            _emit(args.tool, prop, status, tests,
                  int((time.perf_counter() - t0) * 1e6), cex, err)
            total_tests += tests
        if status != "passed" and overall_status == "passed":
            overall_status = status

    return 0  # Always 0; etna reads JSON, not exit code.

if __name__ == "__main__":
    sys.exit(main())
```

The shape is intentionally short — every detail (timing in microseconds,
single-line JSON, exit 0, PascalCase property names, witness replay for
tool=etna) mirrors the Rust runner.

## Property fidelity check

A variant is not done until both passes succeed:

```sh
cd workloads/Python/<name>/etna

# 1. Base: every witness passes.
uv run pytest tests/test_witnesses.py -k <variant>       # all green

# 2. Reverse-apply patch, every witness for this variant fails.
git -C .. apply -R --whitespace=nowarn ../patches/<variant>.patch
uv run pytest tests/test_witnesses.py -k <variant>       # all RED, expected
git -C .. apply --whitespace=nowarn ../patches/<variant>.patch  # restore

# 3. Hypothesis-default backend finds it within max_examples.
uv run etna-runner hypothesis <Property>                 # status: passed (base)
git -C .. apply -R --whitespace=nowarn ../patches/<variant>.patch
uv run etna-runner hypothesis <Property>                 # status: failed
git -C .. apply --whitespace=nowarn ../patches/<variant>.patch
```

If a witness passes on the buggy tree, the property is too coarse. Sharpen
it before committing the variant. See `feedback_release_mode_witness_symmetry`
for the same lesson on the Rust side — Python doesn't have a debug/release
split, but logical equivalents (e.g. a property that asserts presence of an
exception class without checking the message) can silently match the
post-patch error and the pre-patch error.

## CrossHair-specific guidance

CrossHair is a symbolic-execution backend; it only handles **pure Python**.
Variants fall into three buckets at validate time:

1. **Both backends find it** — record `[[tasks.tasks]]` with no annotation.
2. **Hypothesis finds it; CrossHair times out** — record
   `[[tasks.tasks]]` with `crosshair_timeout = true`. Still a valid variant;
   the timeout itself is a useful data point.
3. **Hypothesis finds it; CrossHair errors** (e.g. "cannot symbolically
   execute C extension call") — record under
   `[[dropped_for_backend]]` with the error class. The variant remains
   active for `hypothesis` but is excluded from CrossHair runs.

A whole library getting bucket-3 results uniformly (e.g. lz4/zlib wrappers,
`numpy`-backed code) means it is not a CrossHair candidate. Drop it from the
candidate list; do **not** continue mining.

CrossHair budget per run: default 60 s wall-clock per `@given` invocation.
For overnight benchmark runs, lift to `crosshair --per_path_timeout=10
--per_condition_timeout=300`. Pass through Hypothesis as
`settings(backend="crosshair", database=None, deadline=None)` plus a
`HYPOTHESIS_CROSSHAIR_TIMEOUT` env var if the version exposes one.

## Output contract

Identical to Rust and Lean: one JSON line on stdout per invocation, exit 0
except on argv-parse errors:

```
{"status":"passed|failed|aborted","tests":N,"discards":0,"time":"<us>us",
 "counterexample":STRING|null,"error":STRING|null,
 "tool":"etna|hypothesis|crosshair","property":"<PropName>"}
```

Etna's `log_process_output` (`etna2/src/driver.rs:1400`) reads JSON from
stdout regardless of language. A non-zero exit code becomes
`status: aborted` regardless of payload, so the runner must always exit 0
on a parsed-JSON path.

## Source-of-truth invariants (Python variant)

- `etna.toml` is the only hand-maintained index. `language = "python"`.
  `[[tasks]]` schema as in the Rust pipeline; `[tasks.injection].kind = "patch"`.
- `etna/etna_runner/properties.py` defines every `property_<snake>` referenced by the manifest.
- `etna/etna_runner/strategies.py` defines every `strategy_<snake>` matching a property.
- `etna/etna_runner/witnesses.py` holds every `witness_<snake>_case_<tag>` referenced by
  `[[tasks.tasks]].witnesses[].test_fn`.
- `etna/etna_runner/runner.py` is the dispatch entrypoint; its `ALL_PROPERTIES` list is
  exactly the set of `[[tasks.tasks]].property` values from the manifest.
- `patches/<variant>.patch` is the verbatim output of `git format-patch -1
  <fix-sha>` (or hand-crafted equivalent).
- `progress.jsonl` is appended at every stage boundary (same contract as `run.md`).
- `BUGS.md`, `TASKS.md` are derived; never hand-edited.

## Progress logging

Identical to `run.md`. Stage names: `discover`, `atomize`, `runner`,
`document`, `validate`. Python-specific events to add:

- `discover.event = subtree_filtered` with `python_files_kept = N`,
  `c_extension_files_dropped = M`.
- `atomize.event = property_synthesized` with `property = "<Prop>"`,
  `category = "invariant" | "type_safety" | "round_trip" | "panic_avoidance"`.
- `atomize.event = strategy_synthesized` with `property = "<Prop>"`,
  `crosshair_compatible = true|false`.
- `runner.event = uv_sync_done`, `python_version = "3.12.x"`.
- `validate.event = backend_passed` with `backend = "hypothesis"|"crosshair"`,
  `property = "<Prop>"`, `variant = "<v>"`.
- `validate.event = backend_timed_out` with `backend = "crosshair"`,
  `property = "<Prop>"`, `variant = "<v>"`, `seconds = N`.

Use the same shell helper as `run.md` (set `PROJECT=workloads/Python/<name>`).

## Discover stage filter, refined

When walking `git log --all`, accept commits whose subject matches:

```
^(fix|bug|patch|correct|repair|crash|panic|raise|incorrect|wrong|regression)
| #\d+|GH-\d+
| ^(typo) (with diff touching .py — typos in docstrings often shadow real bugs)
```

Drop commits whose diff is exclusively under:

```
tests/  test/  docs/  doc/  examples/  benchmarks/  conftest.py  *.md  *.rst  *.txt  *.cfg  *.toml  CHANGES*
.github/  .pre-commit-*  .gitignore  .gitattributes  setup.cfg  tox.ini
```

Drop commits whose Python diff is in `_compat.py`, `_py2.py`, or any file
mentioning `if sys.version_info[0] == 2` exclusively — Py2 fixes are not
exercise-able under modern hypothesis-crosshair.

Also drop commits whose only changes are in C extension files: `*.c`,
`*.pyx`, `*.pxd`, `*.h`, `*.so`, `setup.py` build-config edits.

## Non-negotiables

- **Patches only.** No marauders, no in-source `M_<variant>=active` toggles,
  no per-variant git branches.
- **Two backends, one test.** Each property has a single
  `test_property_<snake>.py` test function. The runner re-decorates it with
  the requested `backend=...`. Do **not** write two separate test functions —
  that's the Rust adapter pattern and it's wrong here.
- **CrossHair compatibility is graded, not gated.** If CrossHair times out
  on a variant, record `crosshair_timeout = true` under that
  `[[tasks.tasks]]` and proceed. If CrossHair errors out on a whole library
  (multiple variants, identical error class), drop the library from the
  candidate list. Do **not** silently skip — log to `progress.jsonl`.
- **Witnesses must distinguish.** Run every witness on base (must pass) and
  with the patch reverse-applied (must fail). A witness that passes on the
  buggy tree is silently broken; sharpen the property until it discriminates.
- **Property functions are pure and total.** No `print`, no logging, no I/O,
  no `time.time()`, no `random.*`, no module-level mutation. Same input ⇒
  same `PropertyResult`.
- **Property name is PascalCase in the manifest, snake_case in source.**
  `property = "InsertPreservesSorted"` ↔ `def property_insert_preserves_sorted`.
  Match the Rust pipeline's `pascal_to_snake` mapping.
- **Single Python toolchain.** Pin `requires-python` in `etna/pyproject.toml`
  to whatever `<libname>` ships. Don't bump it during atomize.
- **Runner artefacts live on the base tree.** `etna/`, `etna.toml`,
  `patches/`, and the upstream's untouched files together are the base
  state. Untracked-file workflows break under `git stash` / branch switch.
- **No checkpoint JSONs.** `etna.toml`, `etna/`, and `patches/` are the only
  durable state. `progress.jsonl` is per-run scratch.

## Project: $1

$@
