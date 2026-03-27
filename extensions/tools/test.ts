import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { MAX_OUTPUT_SIZE } from "../constants";

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_SIZE) return text;
  return (
    text.slice(0, MAX_OUTPUT_SIZE) +
    `\n... (truncated, ${text.length} bytes total)`
  );
}

/** Build a shell command that strips M_* env vars and runs cargo test. */
function buildShellCommand(params: {
  workload_dir: string;
  variant?: string;
  test_filter?: string;
  package?: string;
}): string {
  // Unset all M_* env vars to prevent cross-contamination
  const parts: string[] = [];

  // cd to workload directory
  parts.push(`cd ${shellEscape(params.workload_dir)}`);

  // Build the env prefix: unset M_* vars, optionally set the variant
  // We use env -u for each M_* var, but since we don't know them ahead of time,
  // use a subshell that unsets them
  let envPrefix =
    '$(for v in $(env | grep "^M_" | cut -d= -f1); do echo -n "unset $v; "; done)';

  let cargoCmd = "cargo test";
  if (params.package) {
    cargoCmd += ` -p ${shellEscape(params.package)}`;
  }
  cargoCmd += " --";
  if (params.test_filter) {
    cargoCmd += ` ${shellEscape(params.test_filter)}`;
  }

  if (params.variant) {
    // Set the specific variant env var
    parts.push(
      `eval $(for v in $(env | grep "^M_" | cut -d= -f1); do echo "unset $v;"; done) && M_${params.variant}=active ${cargoCmd}`
    );
  } else {
    parts.push(
      `eval $(for v in $(env | grep "^M_" | cut -d= -f1); do echo "unset $v;"; done) && ${cargoCmd}`
    );
  }

  return parts.join(" && ");
}

function shellEscape(s: string): string {
  // Wrap in single quotes, escaping any existing single quotes
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function registerTestTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "etna_cargo_test_base",
    label: "Cargo Test (Base)",
    description:
      "Run cargo tests with no mutation variant active. Returns pass/fail, exit code, stdout/stderr, and duration. All M_* environment variables are stripped.",
    parameters: Type.Object({
      workload_dir: Type.String({
        description: "Path to the workload project directory",
      }),
      timeout: Type.Optional(
        Type.Number({ default: 120, description: "Timeout in seconds" })
      ),
      test_filter: Type.Optional(
        Type.String({ description: "Filter tests by name pattern" })
      ),
      package: Type.Optional(
        Type.String({ description: "Cargo package to test (-p <pkg>)" })
      ),
    }),

    async execute(_toolCallId, params, signal) {
      const {
        workload_dir,
        timeout = 120,
        test_filter,
        package: pkg,
      } = params as {
        workload_dir: string;
        timeout?: number;
        test_filter?: string;
        package?: string;
      };

      const cmd = buildShellCommand({
        workload_dir,
        test_filter,
        package: pkg,
      });

      const start = Date.now();
      const result = await pi.exec("bash", ["-c", cmd], {
        signal,
        timeout: timeout * 1000,
      });
      const duration = (Date.now() - start) / 1000;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              passed: result.code === 0,
              exit_code: result.code,
              stdout: truncate(result.stdout || ""),
              stderr: truncate(result.stderr || ""),
              duration_seconds: Math.round(duration * 100) / 100,
              variant: null,
              timed_out: result.killed || false,
            }),
          },
        ],
      };
    },
  });

  pi.registerTool({
    name: "etna_cargo_test_variant",
    label: "Cargo Test (Variant)",
    description:
      "Run cargo tests with a specific mutation variant active via environment variable M_<variant>=active. Uses functional mutation syntax to avoid recompilation.",
    parameters: Type.Object({
      workload_dir: Type.String({
        description: "Path to the workload project directory",
      }),
      variant: Type.String({
        description: "Variant name to activate (sets M_<variant>=active)",
      }),
      timeout: Type.Optional(
        Type.Number({ default: 120, description: "Timeout in seconds" })
      ),
      test_filter: Type.Optional(
        Type.String({ description: "Filter tests by name pattern" })
      ),
      package: Type.Optional(
        Type.String({ description: "Cargo package to test (-p <pkg>)" })
      ),
    }),

    async execute(_toolCallId, params, signal) {
      const {
        workload_dir,
        variant,
        timeout = 120,
        test_filter,
        package: pkg,
      } = params as {
        workload_dir: string;
        variant: string;
        timeout?: number;
        test_filter?: string;
        package?: string;
      };

      const cmd = buildShellCommand({
        workload_dir,
        variant,
        test_filter,
        package: pkg,
      });

      const start = Date.now();
      const result = await pi.exec("bash", ["-c", cmd], {
        signal,
        timeout: timeout * 1000,
      });
      const duration = (Date.now() - start) / 1000;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              passed: result.code === 0,
              exit_code: result.code,
              stdout: truncate(result.stdout || ""),
              stderr: truncate(result.stderr || ""),
              duration_seconds: Math.round(duration * 100) / 100,
              variant,
              timed_out: result.killed || false,
            }),
          },
        ],
      };
    },
  });
}
