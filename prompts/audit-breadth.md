---
description: Pass-2 audit — classify each property's BREADTH (general vs bug-narrow) independent of mirrored/derived/vacuous
---

# ETNA Workload Audit — Pass 2 (Property Breadth)

This is a focused follow-up to the main `audit.md` pass. The first pass
classified each variant's bug, property, generator, and witness shape.
This pass classifies one additional dimension: **property breadth**.

The motivating question: would an upstream maintainer have written this
property as part of the project's normal test suite, *without knowing the
bug existed*? Or is the property reverse-engineered from the bug — a
narrow assertion that only makes sense once you know the specific
edge-case the fix addresses?

A property can be `mirrored` / `derived` / `vacuous` along the previous
axis AND `general` / `narrow` along this axis — the dimensions are
independent. Examples:

- `mirrored` + `general`: pretty-show's `prop_read_ppShow x = read
  (ppShow x) == x` for arbitrary `D`. A general round-trip contract
  upstream wrote without bug knowledge.
- `derived` + `general`: a property that mirrors a documented contract
  in upstream haddock without narrowing to bug-shape inputs.
- `derived` + `narrow`: derived from a docstring but the property is
  scoped to a specific edge case from the bug (e.g. "validate accepts
  policies with literal entity actions" — only narrow because the
  reader knows that's where the bug was).
- `vacuous` + `narrow`: invented to fit the bug. Worst case.

Output: a JSONL stream of one object per variant with just
`{workload, variant, property_breadth, breadth_reason}`.

## Arguments

- `$1` — absolute path to a workload directory.

## Strict output contract

Same as `audit.md`: stdout is exclusively single-line JSON objects (one
per variant) and one of two sentinel lines.

- `BREADTH_DONE workload=<name> variants=<N>`
- `BREADTH_ABANDON workload=<name> reason=<short>`

Tool calls are fine; only your reply text matters for the contract.

## Step-by-step

### 0. Read the manifest

Open `$1/etna.toml`. Record `name`, `language`, and the list of
`[[tasks]]` blocks.

### 1. For each variant

For each `[[tasks]]` block, for each `[[tasks.tasks]]` entry within it:

1. Locate the property:
   - Rust: `pub fn property_<snake>` in `src/bin/etna.rs` or `src/etna.rs`.
   - Python: `def property_<snake>` in `etna/etna_runner/properties.py`.
   - Haskell: `property_<snake>` in `etna/src/Etna/Properties.hs`.
   - Lean: `property_<snake>` in `<pkg>/Etna/Properties.lean`.

2. Read the property body (assertion + precondition).

3. Read the upstream module/function the property is testing (the file
   listed in `tasks.injection.locations[0].file` and the symbol it
   targets).

4. Apply the **breadth test**: would an upstream maintainer have written
   this property as part of the project's normal test suite, *without
   knowing the bug existed*?

   Concretely, ask:
   - Does the property test a documented contract / API / invariant of
     the function or module under test?
   - Or does it test a behavior that only makes sense once you've seen
     the specific bug fix?

   Indicators of `general`:
   - Property quantifies over the full input type with no bug-specific
     precondition (`forall x : ByteString` rather than `forall x where
     length x == 1`).
   - Assertion matches the function's documented contract (round-trip,
     monotonicity, idempotency, conservation).
   - Could be derived directly from the function's signature/docstring
     without seeing the bug commit.

   Indicators of `narrow`:
   - Property name encodes the bug class
     (`PropertyDoesNotPanicAfterDone`, `ValidateWithLevelAccepts`,
     `BqEuclidSelfDistanceZero`).
   - Assertion is a single-case witness ("for THIS specific input
     shape, the result equals THIS specific value").
   - Precondition narrows to bug-triggering inputs ("only for keys at
     the same hash bucket", "only for inputs of length mod 3 == 1").
   - Reading the property body, you can immediately see the bug it
     was retrofitted to.

5. Classify `property_breadth`:
   - `general` — property would plausibly exist as a standard contract
     test for this function. The bug is one of many things it could
     catch; it's not laser-focused.
   - `narrow` — property is scoped to the bug. An upstream maintainer
     would not write this property as a standalone contract test;
     it only makes sense as bug-pinning.

6. Write a 1-sentence `breadth_reason` explaining the call. Quote
   property body excerpts where helpful.

### 2. Emit one JSON object per variant

```
{"workload":"<name>","language":"<lang>","variant":"<variant>","property":"<PropertyName>","property_breadth":"general|narrow","breadth_reason":"<reason>","audit_ts":"<ISO8601 UTC>"}
```

### 3. Sentinel

```
BREADTH_DONE workload=<name> variants=<N>
```

or `BREADTH_ABANDON workload=<name> reason=<one-line>` on
unrecoverable error.

## Notes

- **Be strict with `general`.** If the property name encodes the bug
  shape or if the assertion only makes sense with bug knowledge, classify
  `narrow`. The user wants to identify properties that are reverse-
  engineered from bugs.
- **Don't punish narrow scope per se.** A property like
  `singularize('senses') == 'sense'` IS narrow (one input, one output),
  but if the docstring documents this exact contract, that's still
  narrow because no random-input quantification exists. The breadth
  axis is about the property's *form*, not its provenance.
- **Single-input witnesses are narrow by definition** — they're
  effectively assertions, not properties. Generators that produce one
  value mean the property is testing one case.

## Project: $1

$@
