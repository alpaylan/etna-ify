# Property & Generator Discipline (read by every `run-*.md`)

This document is the single source of truth for *what makes a workload's
property and generator legitimate*. It is referenced by `run.md`,
`run-haskell.md`, `run-python.md`, and `run-cedar.md`. Read it once at
the start of any etna-ify run; come back to it whenever you're about to
write a property or a generator.

The discipline below was written after auditing 366 variants across 89
workloads (audit at `overnight-logs/audit-all-20260504-124132/findings.jsonl`)
and finding that:

- **44%** of generators were bug-biased (narrowed to inputs that trigger the
  bug, rather than mimicking the upstream library's natural input distribution).
- **48%** of properties were bug-narrow (laser-focused on the bug shape, not
  general contracts a maintainer would write without bug knowledge).
- **0** were structurally hallucinated bugs, but the property/generator
  bias inflates bug-finding rates and deflates shrinking work — both
  confound research that uses the corpus.

This file fixes the two rules whose absence let those numbers happen.

## References

- John Hughes, *How to Specify It! A Guide to Writing Properties of Pure
  Functions*. https://research.chalmers.se/publication/517894/file/517894_Fulltext.pdf
- Scott Wlaschin, *Choosing properties for property-based testing*.
  https://fsharpforfunandprofit.com/posts/property-based-testing-2/

The first is the academic/methodological frame; the second is a pattern
catalog for recognizing properties in the wild. They agree on
substance and are referenced jointly below.

## Rule 1: Property synthesis discipline (Hughes priority order)

When a fix commit suggests a property to assert, do NOT write a property
whose body or precondition references the bug. Instead, walk **Hughes'
5 categories in priority order** and pick the highest-priority category
for which a property exists.

### Priority order

1. **Model-based** (Hughes' "model-based testing", Wlaschin's "test
   oracle"). The strongest category. If a reference / naive / spec
   implementation exists — in the standard library, a sibling crate,
   the upstream's own pre-optimization version, or hand-writable in
   <30 LoC — write `property_<snake>(args) := workload_impl(args) ==
   reference_impl(args)`. Universally applicable when the function has
   declarative semantics.

   Examples in our corpus:
   - `roaring-rs/IterMatchesModel` — RoaringBitmap iterator vs `BTreeSet`. The gold standard.
   - For a sort: `workload_sort xs == Data.List.sort xs`.
   - For a parser: `workload_parse s == reference_parse s` where the
     reference is a hand-written naive parser or a sibling crate.

2. **Postcondition** (Hughes' "postcondition", Wlaschin's "some things
   never change" / safety variants). Assert that the function's output
   satisfies a structural invariant or a contract derivable from the
   function's *type signature and docstring*, with no precondition that
   leaks bug information. Includes:
   - Validity (`isBalanced (insert k v t)`, `isSorted (sort xs)`,
     `0 ≤ index < length`).
   - No-panics (the function is total over its declared input type:
     `forall (x : T). catch_unwind (f x).is_ok()`).
   - No-failures (returns `Ok`/`Just`/`Right` on inputs satisfying the
     declared precondition).
   - Conservation (sum / size / membership preserved as documented).

   Examples: `cassava` "decoded value re-encodes equal", `aho-corasick`
   "match positions within input bounds".

3. **Metamorphic** (Hughes' "metamorphic", Wlaschin's "different paths
   same destination" / "there and back again"). Assert an *equation*
   between two ways of computing the same thing. Includes round-trip
   (`decode . encode = id`), composition (`f . g = h`), and operation
   commutation (`insert k v . delete k = insert k v`). Use this when
   no model is available but the function pairs with an inverse or
   sibling that's well-understood.

   Hughes specifically warns: **round-trip alone is weak** — buggy
   `encode` paired with inverse-buggy `decode` round-trip cleanly. Use
   round-trip only when the inverse is known-correct OR pair it with a
   postcondition.

4. **Algebraic** (Wlaschin's "more things change…" + commutativity /
   associativity / identity / distributivity). Assert algebraic laws:
   `union s s = s` (idempotent); `union a (union b c) = union (union a
   b) c` (associative); `f (zero) = identity`. Use when the function
   should satisfy a known algebraic structure.

5. **Inductive** (Hughes' "inductive properties"). Property holds by
   induction over a recursive structure: base case + step case prove
   the invariant. Use rarely — typically only when the data type is
   recursive AND no model/postcondition fits. Common for tree/list
   libraries.

### The drop rule

**If no Hughes category yields a property whose body and precondition
are bug-independent, DROP THE VARIANT.** Do not invent a 6th
"regression-pinning" property that asserts `f(specific_input) ==
specific_output`. Single-input assertions are unit tests, not
properties. Mining real bugs is the goal; some bugs are observable only
as side effects, performance regressions, or single-input behavioral
deltas — those are kept as upstream regression tests, not as PBT
benchmark variants.

### The two-property rule

Following Hughes (the BST paper shows ~20 properties across 5 categories
to thoroughly test a single library), each variant should have **≥2
properties from different categories** when feasible. A single
postcondition catches a different bug class than a metamorphic property
catches; using both increases the odds the variant catches the bug
under varied generator inputs.

For variants where one category clearly dominates (e.g. a parser bug
where round-trip is the only meaningful test), one property is OK —
but flag this in `etna.toml` so consumers know.

## Rule 2: Generator discipline (library-faithful, not bug-faithful)

When writing a generator for the property's input type, do NOT narrow
the generator to inputs that trigger the bug. Generators must mimic
the upstream library's natural input distribution.

### Mandatory ordering

1. **Use the upstream's own `Arbitrary` / strategy / `Sampleable`
   instance directly** if one exists. Look for:
   - Haskell: `instance Arbitrary <Type>` in `test/`, `tests/`, or any
     sibling `<crate>-arbitrary` package. Or `quickcheck-instances`.
   - Python: `hypothesis.strategies.<...>` invocations in upstream
     tests; custom `@composite` strategies; `from_type` for typed APIs.
   - Rust: `proptest::strategy::Strategy` impls; `prop_compose!{...}`;
     `Arbitrary` via `proptest-derive`; or `quickcheck::Arbitrary`.
   - Lean: `SampleableExt` instances, `Plausible.Sampleable`.

2. **If no upstream generator exists, generate at the natural type**
   using the framework's defaults (`Arbitrary String`, `st.text()`,
   `any::<String>()`, `Plausible.Sampleable.sample`). Never narrow.

3. **Encode preconditions in the PROPERTY body via discard**, not in
   the generator. Example, Haskell:

   ```haskell
   property_<snake> :: String -> PropertyResult
   property_<snake> s
     | not (validInput s) = Discard
     | otherwise = ...
   ```

   This means many trials will discard. That's fine — the survivors
   sample the natural input distribution. The PBT runner reports
   discard rate, which is informative.

### Validation gate

Add this check to `scripts/check_<lang>_workload.py` (for Haskell — and
mirror for the others):

```
For each variant:
  Generate 1000 inputs from gen_<snake>.
  Apply property_<snake> to each.
  Count bug_trigger_rate = (number of failed inputs) / (1000 - discards).
  If bug_trigger_rate > 0.80: FAIL validation — generator is bug-biased.
  If bug_trigger_rate < 0.001: WARN — bug may be unreachable under
    library-faithful generator (consider whether the bug is genuinely
    observable from natural usage).
  Otherwise: PASS — bug is rare-but-reachable, which is what we want
    for shrinking research and for differentiating backends.
```

The validation gate is what actually keeps the corpus honest. Without
it, agents will quietly re-narrow generators because narrowing makes
the witness fire faster and validation feel "easier".

## Rule 3: Witness discipline (unchanged from prior conventions)

Witnesses are plain calls to the property with frozen arguments. No
helper logic, no IO, no setup. Per language:

- Haskell: `witness_<snake>_case_<tag> = property_<snake> <args>`
- Python: `def witness_<snake>_case_<tag>(): return property_<snake>(<args>)`
- Rust: `pub fn witness_<snake>_case_<tag>() -> PropertyResult { property_<snake>(<args>) }`
- Lean: `def witness_<snake>_case_<tag> : PropertyResult := property_<snake> <args>`

Witnesses ARE allowed to be bug-shaped (they're frozen inputs that
demonstrate the bug). Just keep them simple.

## Self-check before declaring atomize complete

For each variant you're about to commit, answer these questions in
your head (or in `progress.jsonl`):

1. Which Hughes category does this property belong to? (model-based /
   postcondition / metamorphic / algebraic / inductive)
2. Could a maintainer have written this property without knowing about
   the bug? (must be yes)
3. Does the generator use the upstream's own `Arbitrary` /
   `Sampleable` / strategy if one exists?
4. If I sampled 1000 inputs from this generator, would <80% trigger
   the bug? (must be yes)
5. Are preconditions encoded inside the property via `discard`, not in
   the generator?

If any answer is no, fix or drop the variant.

## Reference workload to mimic

The legacy **`etna-haskell-bst`** workload at
`/Users/akeles/Programming/projects/PbtBenchmark/etna/workloads/Haskell/BST/`
is the reference implementation from Hughes' paper. It has properties
across all 5 categories on a tree library and is the canonical example.
When unsure how to structure a workload, look there first.
