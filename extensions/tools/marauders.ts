import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

interface MutationEntry {
  file: string;
  line: number;
  name: string;
  active: boolean;
  variants: string[];
  tags: string[];
}

function parseListOutput(stdout: string): MutationEntry[] {
  const mutations: MutationEntry[] = [];
  const re =
    /(.+?):(\d+) \(name: (.+?), active: (.+?), variants: \[(.+?)\], tags: \[(.*?)\]\)/;

  for (const line of stdout.split("\n")) {
    const m = line.match(re);
    if (!m) continue;

    mutations.push({
      file: m[1],
      line: parseInt(m[2], 10),
      name: m[3],
      active: m[4] === "true",
      variants: m[5].split(",").map((v) => v.trim()),
      tags: m[6]
        ? m[6]
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    });
  }

  return mutations;
}

export function registerMaraudersTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "etna_marauders_init",
    label: "Marauders Init",
    description:
      "Initialize a marauder.toml configuration file in a project directory. This MUST be done before injecting mutations or using marauders list/convert.",
    parameters: Type.Object({
      project_dir: Type.String({
        description:
          "Path to project directory where marauder.toml will be created",
      }),
    }),

    async execute(_toolCallId, params, signal) {
      const { project_dir } = params as { project_dir: string };

      const result = await pi.exec(
        "marauders",
        ["init", "--path", project_dir],
        { signal }
      );

      if (result.code !== 0) {
        throw new Error(
          `marauders init failed (exit ${result.code}): ${result.stderr}`
        );
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              project_dir,
              message:
                result.stdout?.trim() || "marauder.toml created successfully",
            }),
          },
        ],
      };
    },
  });

  pi.registerTool({
    name: "etna_marauders_list",
    label: "Marauders List",
    description:
      "List all marauders mutations in a project. Returns structured data with file, line, name, variants, and tags for each mutation.",
    parameters: Type.Object({
      project_dir: Type.String({
        description: "Path to project containing marauder.toml",
      }),
    }),

    async execute(_toolCallId, params, signal) {
      const { project_dir } = params as { project_dir: string };

      const result = await pi.exec(
        "marauders",
        ["list", "--path", project_dir],
        { signal }
      );

      if (result.code !== 0) {
        throw new Error(
          `marauders list failed (exit ${result.code}): ${result.stderr}`
        );
      }

      const mutations = parseListOutput(result.stdout || "");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              count: mutations.length,
              mutations,
            }),
          },
        ],
      };
    },
  });

  pi.registerTool({
    name: "etna_marauders_convert",
    label: "Marauders Convert",
    description:
      "Convert mutation syntax in a file between comment and functional formats. Functional format uses environment variables for runtime variant selection without recompilation.",
    parameters: Type.Object({
      file_path: Type.String({ description: "Path to file to convert" }),
      to: StringEnum(["functional", "comment"] as const),
    }),

    async execute(_toolCallId, params, signal) {
      const { file_path, to } = params as {
        file_path: string;
        to: "functional" | "comment";
      };

      const result = await pi.exec(
        "marauders",
        ["convert", "--path", file_path, "--to", to],
        { signal }
      );

      if (result.code !== 0) {
        throw new Error(
          `marauders convert failed (exit ${result.code}): ${result.stderr}`
        );
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              file: file_path,
              converted_to: to,
              message: result.stdout?.trim() || "Conversion complete",
            }),
          },
        ],
      };
    },
  });
}
