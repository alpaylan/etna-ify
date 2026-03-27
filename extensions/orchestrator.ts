import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";
import { STAGES, STATE_FILE, type Stage } from "./constants";

export interface PipelineState {
  run_id: string;
  project: string;
  project_dir: string;
  stage_order: readonly string[];
  completed_stages: string[];
  current_stage: string | null;
  status: "idle" | "running" | "completed" | "failed";
  started_at: string;
  updated_at: string;
  stage_attempts: Record<
    string,
    { count: number; last_error: string | null; last_attempt_at: string }
  >;
  config: {
    max_attempts: number;
    target_mutations: [number, number];
  };
}

function statePath(projectDir: string): string {
  return path.join(projectDir, "checkpoints", STATE_FILE);
}

export async function loadState(
  projectDir: string
): Promise<PipelineState | null> {
  const p = statePath(projectDir);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf-8");
  return JSON.parse(raw) as PipelineState;
}

export function saveState(state: PipelineState): void {
  const dir = path.join(state.project_dir, "checkpoints");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  state.updated_at = new Date().toISOString();

  const dest = statePath(state.project_dir);
  const tmp = dest + `.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmp, dest);
}

export function createState(
  projectDir: string,
  project: string
): PipelineState {
  return {
    run_id: crypto.randomUUID(),
    project,
    project_dir: path.resolve(projectDir),
    stage_order: STAGES,
    completed_stages: [],
    current_stage: null,
    status: "idle",
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    stage_attempts: {},
    config: {
      max_attempts: 3,
      target_mutations: [20, 50],
    },
  };
}

function nextIncompleteStage(state: PipelineState): string | null {
  for (const stage of state.stage_order) {
    if (!state.completed_stages.includes(stage)) {
      return stage;
    }
  }
  return null;
}

export function advanceStart(
  projectDir: string,
  project: string,
  force: boolean = false
): PipelineState {
  let state = loadStateSync(projectDir);

  if (state && !force) {
    // Resume existing run
    state.status = "running";
    state.current_stage = nextIncompleteStage(state);
  } else {
    // New run
    state = createState(projectDir, project);
    state.status = "running";
    state.current_stage = STAGES[0];
  }

  saveState(state);
  return state;
}

export function advanceComplete(projectDir: string): PipelineState {
  const state = loadStateSync(projectDir);
  if (!state) throw new Error("No pipeline state found");
  if (!state.current_stage) throw new Error("No current stage to complete");

  if (!state.completed_stages.includes(state.current_stage)) {
    state.completed_stages.push(state.current_stage);
  }

  const next = nextIncompleteStage(state);
  if (next) {
    state.current_stage = next;
  } else {
    state.current_stage = null;
    state.status = "completed";
  }

  saveState(state);
  return state;
}

export function advanceFail(
  projectDir: string,
  error: string
): PipelineState {
  const state = loadStateSync(projectDir);
  if (!state) throw new Error("No pipeline state found");
  if (!state.current_stage) throw new Error("No current stage to fail");

  const stage = state.current_stage;
  if (!state.stage_attempts[stage]) {
    state.stage_attempts[stage] = {
      count: 0,
      last_error: null,
      last_attempt_at: "",
    };
  }

  state.stage_attempts[stage].count += 1;
  state.stage_attempts[stage].last_error = error;
  state.stage_attempts[stage].last_attempt_at = new Date().toISOString();

  if (state.stage_attempts[stage].count >= state.config.max_attempts) {
    state.status = "failed";
  }

  saveState(state);
  return state;
}

export function advanceSkip(projectDir: string): PipelineState {
  const state = loadStateSync(projectDir);
  if (!state) throw new Error("No pipeline state found");
  if (!state.current_stage) throw new Error("No current stage to skip");

  if (!state.completed_stages.includes(state.current_stage)) {
    state.completed_stages.push(state.current_stage);
  }

  const next = nextIncompleteStage(state);
  if (next) {
    state.current_stage = next;
  } else {
    state.current_stage = null;
    state.status = "completed";
  }

  saveState(state);
  return state;
}

function loadStateSync(projectDir: string): PipelineState | null {
  const p = statePath(projectDir);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as PipelineState;
}

// Gate checks

interface GateResult {
  gate: string;
  passed: boolean;
  mismatches: string[];
}

function readCheckpointSync(projectDir: string, stage: string): any | null {
  const p = path.join(projectDir, "checkpoints", `${stage}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function isGitRepo(dir: string): boolean {
  if (!dir) return false;
  const gitDir = path.join(dir, ".git");
  return fs.existsSync(gitDir);
}

function resolveRepoDir(projectDir: string, projectName: string, candidates: any, fixes: any): string | null {
  const tried = new Set<string>();
  const candidateDirs = [
    fixes?.repo_dir,
    fixes?.repo_path,
    candidates?.repo_dir,
    candidates?.repo_path,
    path.join(projectDir, "source"),
    projectDir,
    path.join("/tmp", projectName),
    path.join("/private/tmp", projectName),
    // common normalization fallback for names like roaring-rs
    path.join("/tmp", projectName.replace(/-rs$/, "")),
    path.join("/private/tmp", projectName.replace(/-rs$/, "")),
  ].filter((v) => typeof v === "string" && v.length > 0) as string[];

  for (const raw of candidateDirs) {
    const dir = path.resolve(raw);
    if (tried.has(dir)) continue;
    tried.add(dir);
    if (isGitRepo(dir)) return dir;
  }

  return null;
}

function normalizeLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function pickSignalLines(snippet: string): string[] {
  return (snippet || "")
    .split("\n")
    .map((l) => normalizeLine(l))
    .filter((l) => l.length >= 3)
    .filter((l) => l !== "{" && l !== "}" && l !== "else {");
}

export function gateDetection(projectDir: string): GateResult {
  const mutations = readCheckpointSync(projectDir, "mutations");
  const mismatches: string[] = [];

  if (!mutations) {
    return { gate: "detection", passed: false, mismatches: ["mutations.json not found"] };
  }

  for (const m of mutations.mutations || []) {
    if (!m.detected) {
      mismatches.push(
        `Mutation "${m.name}" (variant ${m.variant}) is not detected by any test`
      );
    }
  }

  return { gate: "detection", passed: mismatches.length === 0, mismatches };
}

// Valid property_detector_status values:
// - "detected": property test reliably catches the mutation
// - "property_mapped": property test exists and covers the invariant, but may
//   not trigger reliably in default proptest runs (e.g., 256 cases insufficient)
const VALID_PROPERTY_STATUSES = new Set(["detected", "property_mapped"]);

export function gatePropertyDetector(projectDir: string): GateResult {
  const docs = readCheckpointSync(projectDir, "docs");
  const mismatches: string[] = [];

  if (!docs) {
    return { gate: "property_detector", passed: false, mismatches: ["docs.json not found"] };
  }

  for (const v of docs.variants || []) {
    if (!VALID_PROPERTY_STATUSES.has(v.property_detector_status)) {
      mismatches.push(
        `Variant "${v.variant}" has invalid property_detector_status "${v.property_detector_status}" (expected: detected or property_mapped)`
      );
    }
    if (!v.canonical_failing_property_test && !v.canonical_failing_regression_test) {
      mismatches.push(
        `Variant "${v.variant}" has no canonical failing test (property or regression)`
      );
    }
  }

  return {
    gate: "property_detector",
    passed: mismatches.length === 0,
    mismatches,
  };
}

export function gateSourceCommitConsistency(projectDir: string): GateResult {
  const fixes = readCheckpointSync(projectDir, "fixes");
  const mutations = readCheckpointSync(projectDir, "mutations");
  const candidates = readCheckpointSync(projectDir, "candidates");
  const state = loadStateSync(projectDir);
  const mismatches: string[] = [];

  if (!fixes) {
    return { gate: "source_commit", passed: false, mismatches: ["fixes.json not found"] };
  }
  if (!mutations) {
    return { gate: "source_commit", passed: false, mismatches: ["mutations.json not found"] };
  }

  const projectName = state?.project || path.basename(projectDir);
  const repoDir = resolveRepoDir(projectDir, projectName, candidates, fixes);
  if (!repoDir) {
    return {
      gate: "source_commit",
      passed: false,
      mismatches: [
        "No git repository found for commit verification (tried checkpoints repo_dir/repo_path, project_dir/source, project_dir, and /tmp fallbacks)",
      ],
    };
  }

  const mutationByVariant = new Map(
    (mutations.mutations || []).map((m: any) => [m.variant, m])
  );

  for (const fix of fixes.fixes || []) {
    const variant = fix.variant;
    const mutation = mutationByVariant.get(variant);
    if (!mutation) {
      mismatches.push(`Fix variant "${variant}" missing in mutations.json`);
      continue;
    }

    if (fix.commit && mutation.source_commit && fix.commit !== mutation.source_commit) {
      mismatches.push(
        `Variant "${variant}" has commit mismatch: fixes.json=${fix.commit}, mutations.json=${mutation.source_commit}`
      );
    }

    const commit = mutation.source_commit || fix.commit;
    if (!commit) {
      mismatches.push(`Variant "${variant}" has no source commit`);
      continue;
    }

    const file = mutation.file || fix.file;
    if (!file) {
      mismatches.push(`Variant "${variant}" has no file path for commit verification`);
      continue;
    }

    let diff = "";
    try {
      diff = execSync(`git -C ${JSON.stringify(repoDir)} show --format= --unified=5 ${commit} -- ${JSON.stringify(file)}`, {
        encoding: "utf-8",
      });
    } catch {
      mismatches.push(
        `Variant "${variant}" commit ${commit.slice(0, 7)} could not be shown for file ${file}`
      );
      continue;
    }

    if (!diff || !diff.trim()) {
      mismatches.push(
        `Variant "${variant}" commit ${commit.slice(0, 7)} has no diff for file ${file}`
      );
      continue;
    }

    const added = diff
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => normalizeLine(l.slice(1)));

    const fixedSignals = pickSignalLines(fix.fixed_code || "");

    const hasAddedSignal = fixedSignals.length
      ? fixedSignals.some((line) => added.some((d) => d.includes(line) || line.includes(d)))
      : true;
    // Required: fixing commit must contain at least one fixed-code signal as an added line.
    // (Removed-code matching is intentionally not required; extracted buggy snippets often
    // include surrounding context that does not map 1:1 to removed diff lines.)
    if (!hasAddedSignal) {
      mismatches.push(
        `Variant "${variant}" source commit ${commit.slice(0, 7)} does not contain the extracted fixed snippet in added lines`
      );
    }
  }

  return {
    gate: "source_commit",
    passed: mismatches.length === 0,
    mismatches,
  };
}

export function gateCrossCheckpoint(projectDir: string): GateResult {
  const candidates = readCheckpointSync(projectDir, "candidates");
  const mutations = readCheckpointSync(projectDir, "mutations");
  const report = readCheckpointSync(projectDir, "report");
  const tests = readCheckpointSync(projectDir, "tests");
  const docs = readCheckpointSync(projectDir, "docs");
  const validation = readCheckpointSync(projectDir, "validation");
  const state = loadStateSync(projectDir);

  const mismatches: string[] = [];

  if (!report) {
    return {
      gate: "cross_checkpoint",
      passed: false,
      mismatches: ["report.json not found"],
    };
  }

  // Check 0a: validation.json must exist
  if (!validation) {
    mismatches.push(
      "validation.json checkpoint is missing — the validation stage must write its results"
    );
  }

  // Check 0b: marauder.toml must exist
  const marauderToml = path.join(projectDir, "marauder.toml") ;
  const sourceMarauderToml = path.join(projectDir, "source", "marauder.toml");
  if (!fs.existsSync(marauderToml) && !fs.existsSync(sourceMarauderToml)) {
    mismatches.push(
      "marauder.toml not found in project directory or source/ — marauders cannot operate without it"
    );
  }

  // Check 0c: mutation count vs target
  if (state && report.summary) {
    const [minTarget] = state.config.target_mutations;
    const finalCount = report.summary.mutations_final ?? 0;
    if (finalCount < minTarget) {
      mismatches.push(
        `mutations_final (${finalCount}) is below minimum target (${minTarget}) — consider scanning more commit history or relaxing candidate filters`
      );
    }
  }

  // Check 1: candidates_identified matches candidates array length
  if (candidates && report.summary) {
    if (
      report.summary.candidates_identified !==
      (candidates.candidates || []).length
    ) {
      mismatches.push(
        `report.summary.candidates_identified (${report.summary.candidates_identified}) != candidates.candidates.length (${(candidates.candidates || []).length})`
      );
    }
  }

  // Check 2: mutations_final matches final_mutations array length
  if (report.summary && report.final_mutations) {
    if (
      report.summary.mutations_final !==
      (report.final_mutations || []).length
    ) {
      mismatches.push(
        `report.summary.mutations_final (${report.summary.mutations_final}) != report.final_mutations.length (${(report.final_mutations || []).length})`
      );
    }
  }

  // Check 3: every final mutation exists in mutations.json
  if (mutations && report.final_mutations) {
    const mutationVariants = new Set(
      (mutations.mutations || []).map((m: any) => m.variant)
    );
    for (const fm of report.final_mutations) {
      if (!mutationVariants.has(fm.variant)) {
        mismatches.push(
          `Final mutation "${fm.variant}" not found in mutations.json`
        );
      }
    }
  }

  // Check 4: every failing test in final_mutations exists in tests.json
  if (tests && report.final_mutations) {
    const testVariants = new Set(Object.keys(tests.variants || {}));
    for (const fm of report.final_mutations) {
      if (!testVariants.has(fm.variant)) {
        mismatches.push(
          `Final mutation "${fm.variant}" has no test results in tests.json`
        );
      }
    }
  }

  // Check 5: mutations_undetected == 0
  if (report.summary && report.summary.mutations_undetected !== 0) {
    mismatches.push(
      `report.summary.mutations_undetected is ${report.summary.mutations_undetected}, expected 0`
    );
  }

  // Check 6: every final mutation has a failing regression test
  if (mutations) {
    for (const m of mutations.mutations || []) {
      if (
        !m.failing_tests ||
        (Array.isArray(m.failing_tests) && m.failing_tests.length === 0)
      ) {
        mismatches.push(
          `Mutation "${m.name}" has no failing regression tests`
        );
      }
    }
  }

  // Check 7: every final mutation has a canonical property test in docs.json
  if (docs && report.final_mutations) {
    const docVariants = new Map(
      (docs.variants || []).map((v: any) => [v.variant, v])
    );
    for (const fm of report.final_mutations) {
      const docEntry = docVariants.get(fm.variant);
      if (!docEntry) {
        mismatches.push(
          `Final mutation "${fm.variant}" missing from docs.json`
        );
      } else if (!docEntry.canonical_failing_property_test) {
        mismatches.push(
          `Final mutation "${fm.variant}" has no canonical_failing_property_test in docs.json`
        );
      }
    }
  }

  // Check 8: all checkpoints share the same run_id
  const allCheckpoints = [candidates, mutations, report, tests, docs].filter(
    Boolean
  );
  const runIds = new Set(allCheckpoints.map((c: any) => c.run_id));
  if (runIds.size > 1) {
    mismatches.push(
      `Inconsistent run_ids across checkpoints: ${[...runIds].join(", ")}`
    );
  }

  // Check 9: file paths in report.final_mutations should use full paths matching mutations.json
  if (mutations && report.final_mutations) {
    for (const fm of report.final_mutations) {
      const mutation = (mutations.mutations || []).find(
        (m: any) => m.variant === fm.variant
      );
      if (mutation) {
        const expectedPrefix = `${mutation.file}:${mutation.line}`;
        if (fm.file && fm.file !== expectedPrefix) {
          mismatches.push(
            `Final mutation "${fm.variant}" file path "${fm.file}" doesn't match mutations.json "${expectedPrefix}"`
          );
        }
      }
    }
  }

  // Check 10: BUGS.md exists
  const bugsmd = path.join(projectDir, "BUGS.md");
  const sourceBugsmd = path.join(projectDir, "source", "BUGS.md");
  if (!fs.existsSync(bugsmd) && !fs.existsSync(sourceBugsmd)) {
    mismatches.push("BUGS.md not found in project directory");
  }

  return {
    gate: "cross_checkpoint",
    passed: mismatches.length === 0,
    mismatches,
  };
}
