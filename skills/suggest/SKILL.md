---
name: etna-suggest
description: Evaluate whether a Rust project is suitable for ETNA workload generation, or search for good candidates
---

# Skill: Project Suggestion & Evaluation

## Objective

Evaluate a Rust project (or search for candidates) for suitability as an ETNA workload — a codebase with injected bug mutations and property-based tests for benchmarking PBT tools.

## Evaluation Criteria

Score each criterion 1-5. A project needs a composite score of at least 25/45 to be worth pursuing.

### Must-have (reject if score is 1)

1. **Property-based tests** (1-5): Does the project use PBT frameworks?
   - 5: Multiple frameworks (proptest + quickcheck), extensive PBT suites
   - 3: One framework with moderate coverage
   - 1: No PBT usage at all — **reject**
   - Look for: `proptest!`, `#[quickcheck]`, `quickcheck!`, `Arbitrary`, `prop_compose`, crabcheck imports

2. **Bug-fix history** (1-5): Are there enough classifiable bug fixes in git history?
   - 5: 50+ commits with "fix" in the message, active bug-fix cadence
   - 3: 20-50 fix commits, enough for a workload
   - 1: Fewer than 10 fix commits — unlikely to yield 20 mutations

3. **Compilability** (1-5): Can the project be built and tested reliably?
   - 5: `cargo test` passes cleanly, no exotic build deps
   - 3: Builds with minor adjustments (feature flags, optional deps)
   - 1: Requires system libraries, C bindings, or special hardware

### Important

4. **Bug locality** (1-5): Are bugs typically localized and expressible as mutations?
   - 5: Algorithm library, data structures — bugs are small operator/logic errors
   - 3: Mixed — some localized bugs, some architectural
   - 1: Bugs are mostly architectural, spanning many files

5. **Compile time** (1-5): How fast does `cargo test` run?
   - 5: Under 30 seconds for a full test run
   - 3: 1-3 minutes
   - 1: Over 10 minutes — variant testing becomes impractical

6. **Test density** (1-5): Ratio of test code to implementation code
   - 5: Rich test suite with property tests, unit tests, and integration tests
   - 3: Moderate test coverage
   - 1: Minimal tests — mutations may go undetected

### Nice-to-have

7. **PBT framework diversity** (1-5): Does the project use multiple PBT frameworks?
   - 5: Uses proptest AND quickcheck (or other combinations)
   - 3: Uses one framework well
   - 1: Only basic `#[test]` with no PBT

8. **Crates.io popularity** (1-5): Is the project well-known?
   - 5: Top crate, millions of downloads, widely depended on
   - 3: Established crate with moderate adoption
   - 1: Obscure or unmaintained

9. **License** (1-5): Compatible with redistribution as a benchmark?
   - 5: MIT or Apache-2.0
   - 3: MPL, BSD, or similar permissive
   - 1: GPL or proprietary — problematic for benchmark distribution

## How to Evaluate a Specific Project

1. **Clone or locate** the repo.
2. **Check for PBT usage**: search for `proptest`, `quickcheck`, `Arbitrary`, `prop_compose` in `Cargo.toml` and source files.
3. **Count bug fixes**: `git log --oneline --all | grep -ci fix` for a rough count.
4. **Try building**: `cargo test` — note compile time and pass/fail.
5. **Inspect test files**: look at `tests/`, `src/**/test*`, `#[cfg(test)]` modules.
6. **Check bug locality**: sample 5-10 fix commits and assess diff size and scope.
7. **Check license**: read `LICENSE`, `Cargo.toml` license field.
8. **Check popularity**: look at crates.io download count, GitHub stars.

## How to Search for New Candidates

Good places to look:
- **crates.io categories**: `data-structures`, `algorithms`, `parser-implementations`, `encoding`
- **GitHub topics**: `rust`, `property-based-testing`, `proptest`, `quickcheck`
- **Known PBT-heavy projects**: `im-rs`, `petgraph`, `regex`, `serde`, `nom`, `roaring-rs`, `rust-bio`, `ndarray`
- **Criteria filter**: search crates.io for crates depending on both `proptest` and `quickcheck`

## Output Format

When evaluating, produce a scorecard:

```
Project: <name>
Repository: <url>
License: <license>

Criterion                  Score  Notes
─────────────────────────  ─────  ─────────────────────────────
Property-based tests       4/5    Uses proptest extensively
Bug-fix history            5/5    ~80 fix commits
Compilability              4/5    Builds clean, needs nightly for one feature
Bug locality               5/5    Algorithm library, small diffs
Compile time               3/5    ~90 seconds full test suite
Test density               4/5    Good coverage, 3:1 test ratio
PBT framework diversity    3/5    proptest only
Crates.io popularity       5/5    Top 100 crate
License                    5/5    MIT/Apache-2.0

Composite: 38/45 — RECOMMENDED

Recommendation: <proceed / marginal / skip>
Reason: <one-line summary>
```
