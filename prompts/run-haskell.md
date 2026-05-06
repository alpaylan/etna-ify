---
description: Build an ETNA workload from a Haskell project by mining its git history (QuickCheck + Hedgehog + Falsify + SmallCheck backends)
---

# ETNA Workload Generation — Haskell (QuickCheck / Hedgehog / Falsify / SmallCheck)

Mine the git history of a Haskell library, turn every viable bug fix into a
mutation+property+witness triplet driven by **QuickCheck**, **Hedgehog**,
**Falsify**, and **SmallCheck**, and ship it as an ETNA workload at
`workloads/Haskell/<name>`.

This is the Haskell analogue of `prompts/run.md` (Rust) and
`prompts/run-python.md` (Python). Five stages, no checkpoint JSONs,
`etna.toml` is the source of truth. **Read this file end-to-end before
starting**; the pivots from the Python pipeline are non-trivial.

## Arguments

- `$1` — workload directory (e.g. `workloads/Haskell/text-conversions`). Must
  already be a git working tree containing the upstream library (a fork
  cloned from the canonical repo). The workload directory **is** the upstream
  fork — patches apply against the upstream sources directly. Convention from
  `project_etna_fork_convention`: push to `alpaylan/<dir>-etna`,
  `origin=fork`, `upstream=real`.

## Pipeline

```
discover  ->  atomize  ->  runner  ->  document  ->  validate
```

Run them in order. The skill files in `etna-ify/skills/<stage>/SKILL.md`
describe Rust mechanics; the Haskell deltas in this file override them.

1. **discover** — `git log --all --pretty=format:'%H%x00%ai%x00%s'` over the
   upstream fork. Keep every commit whose subject matches the fix taxonomy
   (see Discover deltas below) **and** whose diff touches the library's
   Haskell source (typically under `src/`, `lib/`, or top-level `*.hs`).
   Drop pure-test/pure-doc commits and commits whose only change is in C
   FFI (`*.c`, `*.h`, `cbits/`) or build-config (`*.cabal`, `package.yaml`,
   `stack.yaml`) — none of the four backends can drive non-Haskell code,
   and pure cabal-flag flips rarely express as observable bugs.
2. **atomize** — one viable fix → one property + one witness + one
   `patches/<variant>.patch` + one `[[tasks]]` group in `etna.toml`. **No
   marauders, no in-source markers, no per-variant git branches.** The patch
   is the durable variant artefact.
3. **runner** — populate `etna/app/Main.hs` with a CLI that dispatches
   `<tool> <property>` programmatically. Tools: `etna` (witness replay),
   `quickcheck`, `hedgehog`, `falsify`, `smallcheck`. The runner is a single
   Haskell executable installed via `etna/etna-runner.cabal`.
4. **document** — generate `BUGS.md` + `TASKS.md` from `etna.toml`. Try
   `etna workload doc <dir>` first; if it rejects `language = "haskell"`,
   fall back to `python scripts/check_haskell_workload.py <dir> --regen-docs`.
5. **validate** — base passes the witness for every property under all four
   backends. Then for each variant: reverse-apply the patch, confirm every
   witness fails, confirm each backend either finds a counterexample within
   budget or times out (timeouts are acceptable for SmallCheck on
   large-search-space variants — record `smallcheck_timeout = true` rather
   than dropping the variant). Restore the patch. Run
   `python scripts/check_haskell_workload.py <dir>` to verify
   manifest/source consistency.

## Pivots from the Python pipeline

| Python (Hypothesis + CrossHair) | Haskell (QuickCheck + Hedgehog + Falsify + SmallCheck) |
|---|---|
| `pyproject.toml` at workload root + `etna/pyproject.toml` (uv) | upstream's `*.cabal`/`package.yaml` untouched; `etna/etna-runner.cabal` is ours. If the upstream already has a `cabal.project`, **append** `etna/` to its `packages:` block (do not overwrite — the upstream's other entries like `web/` matter). If there is no upstream `cabal.project`, create one with `packages: . etna/`. |
| `etna/etna_runner/runner.py` | `etna/app/Main.hs` (single-file CLI; cabal executable target). |
| `def property_<snake>(args) -> PropertyResult` in `properties.py` | `property_<snake> :: Args -> PropertyResult` in `etna/src/Etna/Properties.hs`. `PropertyResult` is `Pass | Fail String | Discard`, defined in `etna/src/Etna/Result.hs`. |
| `def witness_<snake>_case_<tag>()` in `witnesses.py` | `witness_<snake>_case_<tag> :: PropertyResult` in `etna/src/Etna/Witnesses.hs`. Plain top-level value (no IO). |
| `strategy_<snake>` (single Hypothesis strategy reused across backends) | **Four per-framework generators**, one module each: `Etna.Gens.QuickCheck`, `Etna.Gens.Hedgehog`, `Etna.Gens.Falsify`, `Etna.Gens.SmallCheck`. The generator type differs per framework; the value type (`Args`) is shared. |
| Hypothesis re-decorates a single `@given` test with each backend | Four separate test entry points, one per framework. The runner picks one based on `argv[1]`. The shared `property_<snake>` is what each entry point calls — never reimplement the property inside an adapter (same rule as Rust). |
| `git apply --whitespace=nowarn patches/<variant>.patch` | Identical. `git format-patch -1 <fix-sha>` first; hand-craft if it doesn't apply (drift). |
| `python scripts/check_python_workload.py <dir>` | `python scripts/check_haskell_workload.py <dir>` — same invariant set, adapted to Haskell module layout (regex parse of `module Etna.Properties (...)` exports + top-level `property_*` bindings). |
| Pre-commit hook `scripts/workload_precommit.sh` (pinned etna 0.1.7) | Same hook for `etna workload check`, plus `scripts/workload_precommit_haskell.sh` that also runs `cabal test etna-witnesses` and the Haskell checker. |

## Workload directory layout

```
workloads/Haskell/<name>/                      # the upstream fork; do not edit upstream files
  <upstream files...>                          # untouched, including the upstream's *.cabal / package.yaml
  cabal.project                                # ours — pins `packages: . etna/` so cabal sees both
  etna.toml                                    # ours — the manifest (single source of truth)
  patches/<variant>.patch                      # ours — bug-injection patches
  etna/                                        # ours — runner package
    etna-runner.cabal                          # ours — depends on the upstream library by name + the four PBT libs
    src/
      Etna/
        Result.hs                              # PropertyResult definition
        Properties.hs                          # property_<snake> :: Args -> PropertyResult
        Witnesses.hs                           # witness_<snake>_case_<tag> :: PropertyResult
        Gens/
          QuickCheck.hs                        # gen_<snake> :: QC.Gen Args
          Hedgehog.hs                          # gen_<snake> :: H.Gen Args
          Falsify.hs                           # gen_<snake> :: F.Gen Args
          SmallCheck.hs                        # series_<snake> :: Monad m => SC.Series m Args
    app/
      Main.hs                                  # CLI dispatcher; entry point: `etna-runner <tool> <property>`
    test/
      Witnesses.hs                             # cabal test-suite: every witness must equal Pass on base
  progress.jsonl                               # generated; gitignored
  BUGS.md                                      # generated, do not hand-edit
  TASKS.md                                     # generated, do not hand-edit
  README.md                                    # workload-specific README; describes upstream + how to run
```

The upstream library remains importable as-is (e.g. `import Data.Text.Conversions`).
Patches apply against upstream sources at their normal paths — the patch's
`--- a/src/Data/Text/Conversions.hs` headers refer to the workload root.

If the upstream has no `cabal.project`, create one:

```cabal
packages:
    .
    etna/
```

If the upstream **already** has a `cabal.project` (e.g. `pretty-simple`
ships one with `web/`), edit it to append `etna/` to the existing
`packages:` block — do **not** overwrite. Other entries (`web/`, package
sources, `constraints:`, `index-state:`) must be preserved or upstream
build breaks.

`etna/etna-runner.cabal` should look approximately like:

```cabal
cabal-version:      3.0
name:               etna-runner
version:            0.1.0
build-type:         Simple
tested-with:        GHC == 9.6.*

library
    exposed-modules:
        Etna.Result
        Etna.Properties
        Etna.Witnesses
        Etna.Gens.QuickCheck
        Etna.Gens.Hedgehog
        Etna.Gens.Falsify
        Etna.Gens.SmallCheck
    hs-source-dirs:   src
    default-language: Haskell2010
    build-depends:
        base               >=4.18 && <5,
        QuickCheck         >=2.14,
        hedgehog           >=1.4,
        falsify            >=0.2,
        smallcheck         >=1.2,
        <upstream-pkg-name>

executable etna-runner
    main-is:          Main.hs
    hs-source-dirs:   app
    default-language: Haskell2010
    build-depends:
        base,
        etna-runner,
        QuickCheck         >=2.14,
        hedgehog           >=1.4,
        falsify            >=0.2,
        smallcheck         >=1.2,
        <upstream-pkg-name>,
        time,
        data-default

test-suite etna-witnesses
    type:             exitcode-stdio-1.0
    main-is:          Witnesses.hs
    hs-source-dirs:   test
    default-language: Haskell2010
    build-depends:
        base,
        etna-runner
```

**GHC version pin.** Falsify ≥ 0.2 requires `base >= 4.18`, which means
GHC ≥ 9.6. Older GHCs (8.10 / 9.0 / 9.2) won't resolve falsify or modern
hedgehog, and on aarch64-osx GHC 9.2.4 is also known to segfault on the
`pretty-show` build. If `ghcup list -t ghc -c installed` shows nothing
≥ 9.6, run `ghcup install ghc 9.6.6` before building. Pass
`--with-compiler=$(ghcup whereis ghc 9.6.6)` to `cabal` until 9.6 is the
default.

**Why `data-default` is in the executable deps**: `Test.Falsify.Interactive`
re-exports `def` for `Options`, but if you go through
`Test.Falsify.Internal.Driver.falsify` directly (you can't — it's hidden;
see Falsify guidance below) you'd need `data-default` explicitly. Listing
it in the runner deps keeps option construction clean.

The runner is invoked from inside `<workload>/etna/` as
`cabal run etna-runner -- <tool> <property>`. The runner must satisfy the
etna JSON-on-stdout contract (see Output below) and exit 0 except on
argv-parse error.

## Property & generator discipline (REQUIRED reading)

Before writing any property or generator, read
`etna-ify/prompts/property-discipline.md`. It is the single source of truth
for:

1. **Hughes' 5-category property synthesis priority** (model-based >
   postcondition > metamorphic > algebraic > inductive). Pick the
   highest-priority category that fits; never encode the bug shape
   inside the property body or precondition.
2. **Library-faithful generator rule.** Use the upstream's own `Arbitrary`
   instances or `quickcheck-instances` directly. If none exist, generate at
   the natural type with the framework's defaults. Encode preconditions in
   the property body via `PropertyResult::Discard`, never by narrowing the
   generator.
3. **Drop rule.** If no Hughes category yields a bug-independent property,
   drop the variant — do NOT invent a regression-pinning assertion.
4. **Two-property rule.** Aim for ≥2 properties per variant from different
   Hughes categories.
5. **Validation gate.** Bug-trigger rate of the generator must be in
   (0.001, 0.80) — not bug-biased, but reachable.

For Haskell workloads specifically:
- The reference impl for **model-based** is often `Data.List` /
  `Data.Map` / `Data.Set` from `containers`. Compare your specialized
  data structure's operation against the obvious sorted-list / sorted-map
  reference.
- For **no-panics** (postcondition safety), use
  `Control.Exception.try @SomeException (evaluate (force (f x)))` and
  assert `Right`. The four-framework adapters already wrap the property
  call in `try` / `catch_unwind` analogues.
- For **round-trip** parsers, pair `parse . print` with a postcondition
  that the parsed AST is well-formed — Hughes specifically warns that
  round-trip alone allows "buggy print + inverse-buggy parse" to round
  trip cleanly.
- The legacy `etna-haskell-bst` workload at
  `/Users/akeles/Programming/projects/PbtBenchmark/etna/workloads/Haskell/BST/`
  is the canonical example from Hughes' paper. It implements all 5
  categories on a tree library — when in doubt about how to structure
  a workload, copy its patterns.

## Property contract

```haskell
-- etna/src/Etna/Result.hs
module Etna.Result (PropertyResult(..)) where

data PropertyResult
  = Pass
  | Fail !String
  | Discard
  deriving (Show, Eq)
```

```haskell
-- etna/src/Etna/Properties.hs
module Etna.Properties where

import Etna.Result

property_<snake> :: Args -> PropertyResult
property_<snake> args =
  if invariantHolds args
    then Pass
    else Fail (show args ++ ": expected X got Y")
```

Properties take a single `Args` value (a tuple, record, or named newtype —
match what the four generators produce). Pure, total, deterministic. No
`IO`, no `unsafePerformIO`, no module-level mutable state. Same input ⇒
same `PropertyResult`. The property is the only place the invariant is
expressed; every backend adapter calls it.

## Generator contract (one module per framework)

```haskell
-- etna/src/Etna/Gens/QuickCheck.hs
module Etna.Gens.QuickCheck where
import qualified Test.QuickCheck as QC

gen_<snake> :: QC.Gen Args
gen_<snake> = ...
```

```haskell
-- etna/src/Etna/Gens/Hedgehog.hs
module Etna.Gens.Hedgehog where
import qualified Hedgehog.Gen   as Gen
import qualified Hedgehog.Range as Range

gen_<snake> :: Gen.Gen Args
gen_<snake> = ...
```

```haskell
-- etna/src/Etna/Gens/Falsify.hs
module Etna.Gens.Falsify where
import qualified Test.Falsify.Generator as F
import qualified Test.Falsify.Range     as FR

gen_<snake> :: F.Gen Args
gen_<snake> = ...
```

```haskell
-- etna/src/Etna/Gens/SmallCheck.hs
module Etna.Gens.SmallCheck where
import qualified Test.SmallCheck.Series as SC

series_<snake> :: Monad m => SC.Series m Args
series_<snake> = ...
```

Each adapter must drive its own framework's generator — never stub by
delegating to another backend. `Args` is the *same* algebraic data type
across all four; only the generators differ. Provide a `Show` instance for
`Args` (deriving Show on a freshly defined newtype/record is fine) so
counterexamples are renderable.

SmallCheck is a bounded enumeration backend. For variants whose
counterexample lives at depth > ~6 in the value tree, SmallCheck will time
out — record `smallcheck_timeout = true` under the `[[tasks.tasks]]` entry
and proceed (analogue of `crosshair_timeout`). For variants whose
counterexample requires shrinking from a large random value, prefer
QuickCheck and Hedgehog for the killer tests; SmallCheck is the symbolic
counterpart.

## Witness contract

```haskell
-- etna/src/Etna/Witnesses.hs
module Etna.Witnesses where

import Etna.Properties
import Etna.Result

witness_<snake>_case_<tag> :: PropertyResult
witness_<snake>_case_<tag> = property_<snake> (<frozen args>)
```

```haskell
-- etna/test/Witnesses.hs
module Main where

import Etna.Result    (PropertyResult(..))
import Etna.Witnesses (witness_<snake>_case_<tag>, ...)
import System.Exit    (exitFailure, exitSuccess)

main :: IO ()
main = do
  let cases =
        [ ("witness_<snake>_case_<tag>", witness_<snake>_case_<tag>)
        , ...
        ]
  let failures =
        [ (n, msg) | (n, Fail msg) <- cases ] ++
        [ (n, "discard")       | (n, Discard) <- cases ]
  if null failures
    then exitSuccess
    else mapM_ (\(n, m) -> putStrLn (n ++ ": " ++ m)) failures >> exitFailure
```

A witness is a top-level pure value (`PropertyResult`, no `IO`, no
arguments). It calls the property with frozen inputs that — on a base tree
— evaluate to `Pass`, and on a tree with the bug reintroduced (patch
reverse-applied) evaluate to `Fail _`. The fidelity check (run on base ⇒
Pass; run with patch reversed ⇒ Fail) is mandatory before declaring a
variant done.

## Per-framework test entry contract (executed by the runner)

There is **no** library-level `@given`/`Property` test pre-built per
property; the runner constructs the test on demand by combining
`property_<snake>` with the chosen generator. This keeps the source
boilerplate-light and lets us swap shrinking/discard/budget settings per
backend without editing source.

```haskell
-- inside etna/app/Main.hs (sketch)

runQuickCheck :: String -> IO RunResult
runQuickCheck propName = do
  let args = QC.stdArgs { QC.maxSuccess = 200, QC.chatty = False }
  case propName of
    "<PropPascal>" -> do
      r <- QC.quickCheckWithResult args $
             QC.forAll QC.gens.gen_<snake> $ \a ->
               case Etna.Properties.property_<snake> a of
                 Pass    -> QC.property True
                 Discard -> QC.discard
                 Fail m  -> QC.counterexample m (QC.property False)
      pure (toRunResult r)
    _ -> aborted ("unknown property: " ++ propName)
```

Hedgehog: `Hedgehog.forAll gen_<snake>` inside a `Hedgehog.property`,
catch `Hedgehog.Failure` for counterexamples. Falsify: `runProperty` with
`Test.Falsify.Predicate.satisfies`. SmallCheck: `smallCheckM <depth>`
returning the first counterexample.

Each adapter wraps its run in `Control.Exception.try @SomeException` so a
panic in the library-under-test is attributed to the counterexample rather
than aborting the binary (analogue of the Rust adapter's
`std::panic::catch_unwind` rule from `AGENTS.md`). The wrapped panic
string becomes the `error` field; the most recent observed input becomes
the `counterexample` field.

## Mutation injection — patch-only, no branches

Identical mechanics to Cedar/Python:

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
the file moved, was renamed, or a neighboring hunk evolved), hand-craft
the patch against modern `HEAD`. Store it under `patches/<variant>.patch`
in the same git-format-patch shape. See `project_lean_patch_synthesis` for
the same pattern.

## Runner stub (`etna/app/Main.hs`)

This is the **known-good** shape — copy verbatim and adapt the
`<PropPascal>`/`<snake>` placeholders. Validated against the
`pretty-simple` smoke-test workload (4 backends pass on base, all 4
detect the bug after patch reverse). Every import path here matches the
public APIs of the four PBT libraries; the four most common
porting-mistakes are called out inline as `-- NOTE` comments.

```haskell
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE ScopedTypeVariables #-}
module Main where

import           Control.Exception     (SomeException, try)
import           Data.IORef            (newIORef, readIORef, writeIORef, modifyIORef')
import           Data.Time.Clock       (diffUTCTime, getCurrentTime)
import           System.Environment    (getArgs)
import           System.Exit           (exitWith, ExitCode(..))
import           System.IO             (hFlush, stdout)
import           Text.Printf           (printf)

import           Etna.Result           (PropertyResult(..))
import qualified Etna.Properties       as P
import qualified Etna.Witnesses        as W
import qualified Etna.Gens.QuickCheck  as GQ
import qualified Etna.Gens.Hedgehog    as GH
import qualified Etna.Gens.Falsify     as GF
import qualified Etna.Gens.SmallCheck  as GS

import qualified Test.QuickCheck                    as QC
-- NOTE: `Hedgehog.Gen.Gen` does NOT exist — `Gen` lives in the top-level
-- `Hedgehog` module. Importing it from `Hedgehog.Gen` is the most common
-- porting trap.
import qualified Hedgehog                           as HH
-- NOTE: Falsify's `Test.Falsify.Internal.Driver.falsify` is in
-- `other-modules` and not exported. Use `Test.Falsify.Interactive.falsify`
-- — the public wrapper with the right shape `Property' e a -> IO (Maybe e)`.
import qualified Test.Falsify.Interactive           as FI
import qualified Test.Falsify.Property              as FP
-- NOTE: `Test.SmallCheck` does NOT export `smallCheckM`. The IO-driver lives
-- in `Test.SmallCheck.Drivers`. `SC.smallCheck` itself prints to stdout and
-- would corrupt the JSON contract — never call it from the runner.
import qualified Test.SmallCheck                    as SC
import qualified Test.SmallCheck.Drivers             as SCD

-- The full PascalCase set is mirrored from etna.toml. The Haskell checker
-- script verifies this list equals the manifest exactly.
allProperties :: [String]
allProperties = [ "<PropPascal1>", "<PropPascal2>" ]

data Outcome = Outcome
  { oStatus :: String
  , oTests  :: Int
  , oCex    :: Maybe String
  , oErr    :: Maybe String
  }

main :: IO ()
main = do
  argv <- getArgs
  case argv of
    [tool, prop] -> dispatch tool prop
    _            -> do
      putStrLn "{\"status\":\"aborted\",\"error\":\"usage: etna-runner <tool> <property>\"}"
      hFlush stdout
      exitWith (ExitFailure 2)

dispatch :: String -> String -> IO ()
dispatch tool prop
  | prop /= "All" && prop `notElem` allProperties =
      emit tool prop "aborted" 0 0 Nothing (Just $ "unknown property: " ++ prop)
  | otherwise = do
      let targets = if prop == "All" then allProperties else [prop]
      mapM_ (runOne tool) targets

runOne :: String -> String -> IO ()
runOne tool prop = do
  t0 <- getCurrentTime
  result <- try (driver tool prop) :: IO (Either SomeException Outcome)
  t1 <- getCurrentTime
  let us = round ((realToFrac (diffUTCTime t1 t0) :: Double) * 1e6) :: Int
  case result of
    Left e  -> emit tool prop "aborted" 0 us Nothing (Just (show e))
    Right (Outcome status tests cex err) ->
      emit tool prop status tests us cex err

driver :: String -> String -> IO Outcome
driver "etna"       p = runWitnesses p
driver "quickcheck" p = runQuickCheck p
driver "hedgehog"   p = runHedgehog   p
driver "falsify"    p = runFalsify    p
driver "smallcheck" p = runSmallCheck p
driver tool         _ = pure (Outcome "aborted" 0 Nothing (Just ("unknown tool: " ++ tool)))

------------------------------------------------------------------------------
-- Tool: etna (witness replay).  No randomness — runs every frozen-input
-- witness for `prop` and reports the first Fail.
------------------------------------------------------------------------------
runWitnesses :: String -> IO Outcome
runWitnesses prop = case witnessesFor prop of
  []    -> pure (Outcome "aborted" 0 Nothing (Just ("no witnesses for " ++ prop)))
  cs    -> go cs 0
  where
    go [] n = pure (Outcome "passed" n Nothing Nothing)
    go ((name, r):rest) n = case r of
      Pass     -> go rest (n + 1)
      Discard  -> go rest (n + 1)
      Fail msg -> pure (Outcome "failed" (n + 1) (Just name) (Just msg))

-- This table is the runner-local witness index. One per property.
witnessesFor :: String -> [(String, PropertyResult)]
witnessesFor "<PropPascal1>" =
  [ ("witness_<snake1>_case_<tag1>", W.witness_<snake1>_case_<tag1>)
  , ("witness_<snake1>_case_<tag2>", W.witness_<snake1>_case_<tag2>)
  ]
witnessesFor _ = []

------------------------------------------------------------------------------
-- Tool: quickcheck.  Use `quickCheckWithResult`, NOT `quickCheck` (the
-- latter prints to stdout). `chatty = False` keeps stderr quiet too.
------------------------------------------------------------------------------
runQuickCheck :: String -> IO Outcome
runQuickCheck "<PropPascal1>" = do
  let prop args = case P.property_<snake1> args of
        Pass     -> QC.property True
        Discard  -> QC.discard
        Fail msg -> QC.counterexample msg (QC.property False)
  result <- QC.quickCheckWithResult
              QC.stdArgs { QC.maxSuccess = 200, QC.chatty = False }
              (QC.forAll GQ.gen_<snake1> prop)
  case result of
    QC.Success { QC.numTests = n } -> pure (Outcome "passed" n Nothing Nothing)
    QC.Failure { QC.numTests = n, QC.failingTestCase = tc } ->
      pure (Outcome "failed" n (Just (concat tc)) Nothing)
    QC.GaveUp  { QC.numTests = n } -> pure (Outcome "aborted" n Nothing (Just "QuickCheck gave up"))
    QC.NoExpectedFailure { QC.numTests = n } ->
      pure (Outcome "aborted" n Nothing (Just "no expected failure"))
runQuickCheck p = pure (Outcome "aborted" 0 Nothing (Just ("unknown property: " ++ p)))

------------------------------------------------------------------------------
-- Tool: hedgehog.  Counterexample capture is best-effort because
-- `HH.check` only writes the cex to stderr.  See "Hedgehog-specific
-- guidance" above for path-2 (Internal.Property.runProperty) if needed.
------------------------------------------------------------------------------
runHedgehog :: String -> IO Outcome
runHedgehog "<PropPascal1>" = do
  let test = HH.property $ do
        args <- HH.forAll GH.gen_<snake1>
        case P.property_<snake1> args of
          Pass     -> pure ()
          Discard  -> HH.discard
          Fail msg -> do
            HH.annotate msg
            HH.failure
  ok <- HH.check test
  if ok
    then pure (Outcome "passed" 200 Nothing Nothing)
    else pure (Outcome "failed" 1 Nothing Nothing)
runHedgehog p = pure (Outcome "aborted" 0 Nothing (Just ("unknown property: " ++ p)))

------------------------------------------------------------------------------
-- Tool: falsify.  Use the public `Test.Falsify.Interactive.falsify`.
-- The internal `Test.Falsify.Internal.Driver.falsify` has more detail
-- (success counts, replay seed) but is hidden — don't import it.
------------------------------------------------------------------------------
runFalsify :: String -> IO Outcome
runFalsify "<PropPascal1>" = do
  let prop = do
        args <- FP.gen GF.gen_<snake1>
        case P.property_<snake1> args of
          Pass     -> pure ()
          Discard  -> FP.discard
          Fail msg -> FP.testFailed (show args ++ ": " ++ msg)
  mFailure <- FI.falsify prop
  case mFailure of
    Nothing  -> pure (Outcome "passed" 100 Nothing Nothing)
    Just msg -> pure (Outcome "failed" 1 (Just msg) Nothing)
runFalsify p = pure (Outcome "aborted" 0 Nothing (Just ("unknown property: " ++ p)))

------------------------------------------------------------------------------
-- Tool: smallcheck.  `SC.over` binds the explicit series; `SC.monadic`
-- lifts an `IO Bool` to `Property IO`.  `SCD.smallCheckM` is the IO driver.
------------------------------------------------------------------------------
runSmallCheck :: String -> IO Outcome
runSmallCheck "<PropPascal1>" = do
  countRef <- newIORef (0 :: Int)
  let depth = 5
      check args = SC.monadic $ do
        modifyIORef' countRef (+1)
        pure $ case P.property_<snake1> args of
          Pass    -> True
          Discard -> True
          Fail _  -> False
      smTest = SC.over GS.series_<snake1> check
  res <- try (SCD.smallCheckM depth smTest)
           :: IO (Either SomeException (Maybe SCD.PropertyFailure))
  n <- readIORef countRef
  case res of
    Left e          -> pure (Outcome "failed" n Nothing (Just (show e)))
    Right Nothing   -> pure (Outcome "passed" n Nothing Nothing)
    Right (Just pf) -> pure (Outcome "failed" n (Just (show pf)) Nothing)
runSmallCheck p = pure (Outcome "aborted" 0 Nothing (Just ("unknown property: " ++ p)))

------------------------------------------------------------------------------
-- Output (single JSON line, exit 0 except on argv error)
------------------------------------------------------------------------------
emit :: String -> String -> String -> Int -> Int -> Maybe String -> Maybe String -> IO ()
emit tool prop status tests us cex err = do
  let q = quoteJSON
      esc Nothing  = "null"
      esc (Just s) = q s
  printf "{\"status\":%s,\"tests\":%d,\"discards\":0,\"time\":\"%dus\",\"counterexample\":%s,\"error\":%s,\"tool\":%s,\"property\":%s}\n"
    (q status) tests us (esc cex) (esc err) (q tool) (q prop)
  hFlush stdout

quoteJSON :: String -> String
quoteJSON s = '"' : concatMap esc s ++ "\""
  where
    esc '"'  = "\\\""
    esc '\\' = "\\\\"
    esc '\n' = "\\n"
    esc '\r' = "\\r"
    esc '\t' = "\\t"
    esc c | fromEnum c < 0x20 = printf "\\u%04x" (fromEnum c)
          | otherwise = [c]
```

The shape is intentionally short — every detail (microsecond timing,
single-line JSON, exit 0 except on argv-parse error, PascalCase property
names, witness replay for `tool=etna`) mirrors the Rust and Python
runners. The runner you saw working in `workloads/Haskell/pretty-simple/etna/app/Main.hs`
is this stub with one property concretely wired in.

## Property fidelity check

A variant is not done until both passes succeed:

```sh
cd workloads/Haskell/<name>

# 1. Base: every witness passes.
cabal test etna-witnesses                              # all green

# 2. Reverse-apply patch, every witness for this variant fails.
git apply -R --whitespace=nowarn patches/<variant>.patch
cabal test etna-witnesses                              # RED, expected
git apply    --whitespace=nowarn patches/<variant>.patch  # restore

# 3. Each backend finds it within budget.
cd etna
cabal run etna-runner -- quickcheck <Property>         # status: passed (base)
git -C .. apply -R --whitespace=nowarn ../patches/<variant>.patch
cabal run etna-runner -- quickcheck <Property>         # status: failed
git -C .. apply    --whitespace=nowarn ../patches/<variant>.patch
# Repeat for hedgehog, falsify, smallcheck (smallcheck may legitimately
# time out — annotate `smallcheck_timeout = true` and proceed).
```

If a witness passes on the buggy tree, the property is too coarse. Sharpen
it before committing the variant. See `feedback_release_mode_witness_symmetry`
for the same lesson on the Rust side — Haskell's `-O0` vs `-O2` split also
produces the equivalent footgun (e.g. fusion-related rewrites change
behavior under `-O2` only). Run the witness suite with the same
optimization flags the runner uses; default both to `-O1` and don't mix.

## SmallCheck-specific guidance

SmallCheck is a bounded-enumeration backend; counterexamples must live at
depth ≤ N for some small N.

**Driver entry point**: `Test.SmallCheck.Drivers.smallCheckM`, *not*
`Test.SmallCheck.smallCheckM` — the `Test.SmallCheck` module re-exports
`smallCheck` (which prints to stdout — corrupts the JSON contract) but
**not** `smallCheckM`. Import explicitly:

```haskell
import qualified Test.SmallCheck         as SC
import qualified Test.SmallCheck.Drivers as SCD
```

**Adapter pattern**: there is no `forAll`-with-explicit-series in the
public `Testable` instances (only `Testable IO Bool`, `Testable IO
(Either Reason Reason)`, and `Testable IO (Property IO)`). To run a
`series_<snake>` against a property that has IO state (e.g. an `IORef`
counter), wrap the per-input check in `SC.monadic` and quantify with
`SC.over`:

```haskell
runSmallCheck "<Prop>" = do
  countRef <- newIORef (0 :: Int)
  let depth = 5
      check args = SC.monadic $ do
        modifyIORef' countRef (+1)
        pure $ case P.property_<snake> args of
          Pass    -> True
          Discard -> True
          Fail _  -> False
      smTest = SC.over GS.series_<snake> check
  res <- try (SCD.smallCheckM depth smTest)
           :: IO (Either SomeException (Maybe SCD.PropertyFailure))
  n  <- readIORef countRef
  case res of
    Left e          -> pure (Outcome "failed" n Nothing (Just (show e)))
    Right Nothing   -> pure (Outcome "passed" n Nothing Nothing)
    Right (Just pf) -> pure (Outcome "failed" n (Just (show pf)) Nothing)
```

`SC.over :: (Show a, Testable m b) => Series m a -> (a -> b) -> Property m`
is what binds the explicit series. `SC.monadic` lifts an `IO Bool` into
`Property IO` so the `Testable` resolution succeeds.

Variants fall into three buckets at validate time:

1. **All four backends find it** — record `[[tasks.tasks]]` with no
   annotation.
2. **QuickCheck/Hedgehog/Falsify find it; SmallCheck times out at depth
   12** — record `[[tasks.tasks]]` with `smallcheck_timeout = true`.
   Still a valid variant; the timeout itself is a useful data point.
3. **Three backends find it; SmallCheck errors** (e.g. instance
   resolution fails because the input type isn't `Serial m`) — record
   under `[[dropped_for_backend]]` with the error class. The variant
   remains active for the other three backends but is excluded from
   SmallCheck runs.

A whole library getting bucket-3 results uniformly (e.g. needs custom
`Series` for every input type) means it is not a SmallCheck candidate;
keep it on the other three. Do **not** silently skip SmallCheck — log to
`progress.jsonl` (`validate.event = backend_dropped`).

SmallCheck budget per run: depth 6 by default; bump to 8 for variants
where the counterexample is structurally small but values are large
(e.g. character-set mismatches). For overnight benchmark runs, lift to
`smallCheckWithHook 12 ...`.

## Falsify-specific guidance

Falsify is the integrated-shrinking backend (analogous to Hedgehog but
with internal shrinking strategy differences). Generators are
`Test.Falsify.Generator.Gen a`.

**Run via the public `Test.Falsify.Interactive.falsify`**, not
`Test.Falsify.Internal.Driver.falsify` — the latter is in the
`other-modules` list and won't resolve from outside the falsify package.
The Interactive wrapper has the right signature for an adapter:

```haskell
import qualified Test.Falsify.Interactive as FI
import qualified Test.Falsify.Property    as FP

runFalsify "<Prop>" = do
  let prop = do
        args <- FP.gen GF.gen_<snake>
        case P.property_<snake> args of
          Pass     -> pure ()
          Discard  -> FP.discard
          Fail msg -> FP.testFailed (show args ++ ": " ++ msg)
  mFailure <- FI.falsify prop                -- :: IO (Maybe String)
  case mFailure of
    Nothing  -> pure (Outcome "passed" 100 Nothing Nothing)
    Just msg -> pure (Outcome "failed" 1 (Just msg) Nothing)
```

`FI.falsify` runs with default `Options` (100 tests, default shrink
budget) and returns `Maybe String` — the rendered counterexample on
failure. If you need to override the test count, use
`Test.Falsify.Internal.Driver.Tasty` or write a small tasty wrapper, but
default options are usually fine for the etna-driver budget.

Falsify generators do **not** share types with Hedgehog or QuickCheck —
write `Etna.Gens.Falsify.gen_<snake>` from scratch, not by lifting
Hedgehog's. For numeric ranges, prefer `Test.Falsify.Range.between`
(requires `(Integral a, FiniteBits a)` — `Word`/`Int` work, `Char`
doesn't). For collections, use `Test.Falsify.Generator.list :: Range Word
-> Gen a -> Gen [a]`. For picking from a fixed set of values, use
`Test.Falsify.Generator.elem :: NonEmpty a -> Gen a` — note this requires
a `Data.List.NonEmpty.NonEmpty`, so add a tiny `ne :: [a] -> NonEmpty a`
helper for character-set generators.

## Hedgehog-specific guidance

Hedgehog generators are `Hedgehog.Gen` — the type lives in the top-level
`Hedgehog` module, **not** in `Hedgehog.Gen`. Import as
`import Hedgehog (Gen)` and `import qualified Hedgehog.Gen as Gen`. The
`Hedgehog.Gen` module re-exports `element` (singular), `string`, `list`,
etc., but not the type itself. (`Hedgehog.Gen.Gen` does not exist —
that's the most common type-error trap when porting.)

Hedgehog's public `HH.check` returns `Bool` but only writes the
counterexample to stderr; capturing it programmatically is awkward. For
adapter purposes either:

1. Accept the limitation: report `failed` with `counterexample = null`
   when `check` returns False. This is the path taken by the smoke-test
   workload (`workloads/Haskell/pretty-simple`) and is acceptable for
   benchmarking purposes since the etna driver primarily cares about
   pass/fail counts, not the cex string.
2. Drop down to `Hedgehog.Internal.Property.runProperty` to capture the
   `Report` struct (which carries the rendered shrunk input). This
   pulls in an internal module — fine for a runner, but worth noting in
   `etna.toml` so the dependency surface is auditable.

Path 1 is the recommended default. Bump to path 2 if the etna driver
ever starts asserting on the cex contents.

## QuickCheck-specific guidance

Standard `Test.QuickCheck`. Set `QC.stdArgs { QC.chatty = False, QC.maxSuccess
= N }`; do not use `quickCheck` (which prints to stdout — corrupts the JSON
contract). Use `quickCheckWithResult`. Recover counterexamples from
`Result` (case `Failure { failingTestCase = ... }`).

## Output contract

Identical to Rust, Python, and Lean: one JSON line on stdout per
invocation, exit 0 except on argv-parse errors:

```
{"status":"passed|failed|aborted","tests":N,"discards":0,"time":"<us>us",
 "counterexample":STRING|null,"error":STRING|null,
 "tool":"etna|quickcheck|hedgehog|falsify|smallcheck","property":"<PropName>"}
```

Etna's `log_process_output` (`etna2/src/driver.rs:1400`) reads JSON from
stdout regardless of language. A non-zero exit code becomes
`status: aborted` regardless of payload, so the runner must always exit 0
on a parsed-JSON path.

## Source-of-truth invariants (Haskell variant)

- `etna.toml` is the only hand-maintained index. `language = "haskell"`.
  `[[tasks]]` schema as in the Python pipeline; `[tasks.injection].kind = "patch"`.
- `etna/src/Etna/Properties.hs` defines every `property_<snake>` referenced
  by the manifest.
- `etna/src/Etna/Gens/{QuickCheck,Hedgehog,Falsify,SmallCheck}.hs` each
  define a generator (or series) for every property.
- `etna/src/Etna/Witnesses.hs` holds every `witness_<snake>_case_<tag>`
  referenced by `[[tasks.tasks]].witnesses[].test_fn`.
- `etna/app/Main.hs` is the dispatch entrypoint; its `allProperties` list
  is exactly the set of `[[tasks.tasks]].property` values from the manifest.
- `patches/<variant>.patch` is the verbatim output of `git format-patch -1
  <fix-sha>` (or hand-crafted equivalent).
- `progress.jsonl` is appended at every stage boundary (same contract as
  `run.md`).
- `BUGS.md`, `TASKS.md` are derived; never hand-edited.
- Every `runQuickCheck` / `runHedgehog` / `runFalsify` / `runSmallCheck`
  actually drives its own framework — no stub delegating to witness replay
  or another backend (same rule as the Rust adapter mandate in `AGENTS.md`).

## Progress logging

Identical to `run.md`. Stage names: `discover`, `atomize`, `runner`,
`document`, `validate`. Haskell-specific events to add:

- `discover.event = subtree_filtered` with `haskell_files_kept = N`,
  `c_ffi_files_dropped = M`, `cabal_only_dropped = K`.
- `atomize.event = property_synthesized` with `property = "<Prop>"`,
  `category = "invariant" | "type_safety" | "round_trip" | "panic_avoidance"`.
- `atomize.event = generators_synthesized` with `property = "<Prop>"`,
  `quickcheck = true|false`, `hedgehog = true|false`,
  `falsify = true|false`, `smallcheck = true|false`.
- `runner.event = cabal_build_done` with `ghc_version = "9.6.x"`.
- `validate.event = backend_passed` with
  `backend = "quickcheck"|"hedgehog"|"falsify"|"smallcheck"`,
  `property = "<Prop>"`, `variant = "<v>"`.
- `validate.event = backend_timed_out` with `backend = "smallcheck"`,
  `property = "<Prop>"`, `variant = "<v>"`, `seconds = N`.
- `validate.event = backend_dropped` with `backend = "<bn>"`,
  `property = "<Prop>"`, `variant = "<v>"`, `reason = "..."`.

Use the same shell helper as `run.md` (set `PROJECT=workloads/Haskell/<name>`).

## Candidate-library selection

Independently of which library you mine, picking a library where the
discover stage will yield substantive variants matters as much as the
filter. Empirical observation from running the pipeline on 6 Haskell
candidates (`extra`, `parser-combinators`, `safe`, `email-validate`,
`base64-bytestring`, `aeson`):

- **Most "Fix" commits in pure-Haskell utility libraries are CI / build /
  GHC-compat / haddock fixes**, not correctness fixes. Filtering by subject
  alone leaves you with a mostly-empty pool.
- **Libraries with rich correctness-fix history are typically parsers,
  serializers, or data-structure implementations** with adversarial
  inputs: `aeson` (JSON), `attoparsec`, `cassava` (CSV), `base64-bytestring`,
  `text` (encoding), `containers`/`unordered-containers`. These also tend
  to be larger.
- **Sub-package monorepos** (e.g. `aeson` ships `text-iso8601`,
  `attoparsec-iso8601`, `attoparsec-aeson` as sibling packages) are a
  good shape for narrow workloads — clone the whole monorepo, narrow the
  workload's `cabal.project` to just the sub-package of interest plus
  `etna/`. The historical fix lives in a small subtree, the build cost
  is small, and the patch path stays stable.
- **Avoid**: libraries dominated by `unsafePerformIO` / `ForeignPtr` /
  C FFI (e.g. `base64-bytestring`'s `joinWith` memory-corruption fix is
  a real bug but the property test of "right output length" doesn't
  consistently fail because the bytestring length field is correct even
  when memory writes are out-of-bounds — the bug is undefined behavior,
  not visible behavior). Stick to pure-Haskell logic where the buggy
  output is observable.
- **Avoid**: build-config-only fixes ("Fix CPP", "Fix for older GHC",
  "Fix bounds, were 1.0 away" in #if conditions). They don't manifest
  as runtime invariant failures.

The smoke-test workloads `pretty-simple` (small standalone library, the
parser sub-module) and `aeson` (monorepo, narrowed to the `text-iso8601`
sub-package) demonstrate the two shapes that work best:
small-library-as-workload and sub-package-as-workload. In both cases the
workload directory name matches the upstream repo name, even when the
test target is a single sub-package within the upstream — the directory
is the upstream clone, full stop.

## Discover stage filter, refined

When walking `git log --all`, accept commits whose subject matches:

```
^(fix|bug|patch|correct|repair|crash|panic|raise|incorrect|wrong|regression)
| #\d+|GH-\d+
| ^(typo) (with diff touching .hs — typos in identifiers often shadow real bugs)
```

Drop commits whose diff is exclusively under:

```
test/  tests/  benchmark/  benchmarks/  bench/  doc/  docs/  examples/
*.md  *.rst  *.txt  *.cabal  package.yaml  stack.yaml  stack.yaml.lock
.github/  .gitignore  .gitattributes  CHANGELOG*  CHANGES*
hie.yaml  cabal.project  cabal.project.freeze
```

Drop commits whose only changes are in C FFI: `*.c`, `*.h`, `cbits/`,
`include/`. Drop commits that only flip cabal flags or bump a `build-depends`
upper bound — they don't express as observable bugs in pure Haskell code.

## Non-negotiables

- **Patches only.** No marauders, no in-source `M_<variant>=active`
  toggles, no per-variant git branches.
- **Four backends, four generators, one property.** Each property has a
  single `property_<snake>` definition in `Etna.Properties`. The runner
  combines it with one of four per-framework generator modules at
  dispatch time. Do **not** write a separate property body per backend —
  that's how the Rust pipeline accidentally lost cross-framework parity
  (see `feedback_no_stubs`).
- **SmallCheck timeout is graded, not gated.** If SmallCheck times out on
  a variant, record `smallcheck_timeout = true` under that
  `[[tasks.tasks]]` and proceed. If SmallCheck errors out structurally
  (no `Serial` instance for `Args`), drop it from that variant via
  `[[dropped_for_backend]]`. Do **not** silently skip — log to
  `progress.jsonl`.
- **Witnesses must distinguish.** Run every witness on base (must equal
  `Pass`) and with the patch reverse-applied (must equal `Fail _`). A
  witness that passes on the buggy tree is silently broken; sharpen the
  property until it discriminates.
- **Property values are pure and total.** No `IO`, no
  `unsafePerformIO`, no `Debug.Trace.trace`, no module-level
  `IORef`/`MVar`. Same input ⇒ same `PropertyResult`.
- **Property name is PascalCase in the manifest, snake_case in source.**
  `property = "InsertPreservesSorted"` ↔
  `property_insert_preserves_sorted`. Match the Rust pipeline's
  `pascal_to_snake` mapping (`etna2/src/commands/workload/check.rs:307`).
- **Single GHC toolchain.** Pin `tested-with: GHC == 9.6.<x>` in
  `etna-runner.cabal` to whatever the upstream's `*.cabal` declares as
  the canonical version. Don't bump it during atomize.
- **Runner artefacts live on the base tree.** `etna/`, `etna.toml`,
  `cabal.project`, `patches/`, and the upstream's untouched files
  together are the base state. Untracked-file workflows break under
  `git stash` / branch switch.
- **No checkpoint JSONs.** `etna.toml`, `etna/`, and `patches/` are the
  only durable state. `progress.jsonl` is per-run scratch.
- **Per-framework adapter must drive its framework.** Every `run<Tool>`
  function in `Main.hs` calls into its own PBT library — no stub
  delegating to witness replay or another backend.

## Project: $1

$@
