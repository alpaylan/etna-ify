import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { MAX_OUTPUT_SIZE } from "../constants";

interface DiffHunk {
  header: string;
  old_start: number;
  new_start: number;
  content: string;
}

interface DiffFile {
  path: string;
  status: string;
  hunks: DiffHunk[];
}

interface CommitInfo {
  hash: string;
  author: string;
  date: string;
  message: string;
  files: DiffFile[];
}

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = raw.split("\n");
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let hunkLines: string[] = [];

  for (const line of lines) {
    const fileMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (fileMatch) {
      if (currentHunk && currentFile) {
        currentHunk.content = hunkLines.join("\n");
        currentFile.hunks.push(currentHunk);
      }
      currentFile = { path: fileMatch[2], status: "modified", hunks: [] };
      files.push(currentFile);
      currentHunk = null;
      hunkLines = [];
      continue;
    }

    if (line.startsWith("new file")) {
      if (currentFile) currentFile.status = "added";
      continue;
    }
    if (line.startsWith("deleted file")) {
      if (currentFile) currentFile.status = "deleted";
      continue;
    }

    const hunkMatch = line.match(
      /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/
    );
    if (hunkMatch && currentFile) {
      if (currentHunk) {
        currentHunk.content = hunkLines.join("\n");
        currentFile.hunks.push(currentHunk);
      }
      currentHunk = {
        header: line,
        old_start: parseInt(hunkMatch[1], 10),
        new_start: parseInt(hunkMatch[2], 10),
        content: "",
      };
      hunkLines = [hunkMatch[3] ? hunkMatch[3].trimStart() : ""];
      continue;
    }

    if (currentHunk) {
      hunkLines.push(line);
    }
  }

  if (currentHunk && currentFile) {
    currentHunk.content = hunkLines.join("\n");
    currentFile.hunks.push(currentHunk);
  }

  return files;
}

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_SIZE) return text;
  return (
    text.slice(0, MAX_OUTPUT_SIZE) +
    `\n... (truncated, ${text.length} bytes total)`
  );
}

export function registerGitTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "etna_git_batch",
    label: "Git Batch",
    description:
      "Fetch a batch of commits with diffs from a git repository. Returns commit metadata and parsed unified diffs for each commit.",
    parameters: Type.Object({
      repo: Type.String({ description: "Path to git repository" }),
      offset: Type.Number({
        default: 0,
        description: "Number of commits to skip",
      }),
      count: Type.Number({
        default: 50,
        description: "Number of commits to fetch",
      }),
      branch: Type.Optional(
        Type.String({ description: "Branch to scan (default: HEAD)" })
      ),
    }),

    async execute(_toolCallId, params, signal) {
      const { repo, offset = 0, count = 50, branch } = params as {
        repo: string;
        offset?: number;
        count?: number;
        branch?: string;
      };

      const branchArg = branch ? [branch] : [];
      const logResult = await pi.exec(
        "git",
        [
          "-C",
          repo,
          "log",
          "--no-merges",
          `--skip=${offset}`,
          `-n${count}`,
          "--format=%H\t%an <%ae>\t%aI\t%s",
          ...branchArg,
        ],
        { signal }
      );

      if (!logResult.stdout?.trim()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                commits: [],
                total_fetched: 0,
                offset,
              }),
            },
          ],
        };
      }

      const commits: CommitInfo[] = [];
      const logLines = logResult.stdout.trim().split("\n");

      for (const logLine of logLines) {
        const parts = logLine.split("\t");
        if (parts.length < 4) continue;

        const [hash, author, date, ...messageParts] = parts;
        const message = messageParts.join("\t");

        const diffResult = await pi.exec(
          "git",
          ["-C", repo, "diff-tree", "-p", "--root", "--no-commit-id", hash],
          { signal }
        );

        const files = parseDiff(diffResult.stdout || "");

        commits.push({ hash, author, date, message, files });
      }

      const output = JSON.stringify({
        commits,
        total_fetched: commits.length,
        offset,
      });

      return {
        content: [{ type: "text", text: truncate(output) }],
      };
    },
  });

  pi.registerTool({
    name: "etna_git_show",
    label: "Git Show",
    description:
      "Get full details of a single commit including metadata and parsed diff.",
    parameters: Type.Object({
      repo: Type.String({ description: "Path to git repository" }),
      commit: Type.String({ description: "Commit hash" }),
    }),

    async execute(_toolCallId, params, signal) {
      const { repo, commit } = params as { repo: string; commit: string };

      const metaResult = await pi.exec(
        "git",
        [
          "-C",
          repo,
          "show",
          "--format=%H\t%an <%ae>\t%aI\t%B",
          "--no-patch",
          commit,
        ],
        { signal }
      );

      const metaLines = (metaResult.stdout || "").split("\t");
      const hash = metaLines[0] || commit;
      const author = metaLines[1] || "";
      const date = metaLines[2] || "";
      const message = metaLines.slice(3).join("\t").trim();

      const diffResult = await pi.exec(
        "git",
        ["-C", repo, "diff-tree", "-p", "--root", "--no-commit-id", commit],
        { signal }
      );

      const files = parseDiff(diffResult.stdout || "");

      const output = JSON.stringify({ hash, author, date, message, files });

      return {
        content: [{ type: "text", text: truncate(output) }],
      };
    },
  });

  pi.registerTool({
    name: "etna_git_diff_range",
    label: "Git Diff Range",
    description:
      "Get the composed diff between two commits, parsed into structured file/hunk data.",
    parameters: Type.Object({
      repo: Type.String({ description: "Path to git repository" }),
      from_commit: Type.String({ description: "Start commit hash" }),
      to_commit: Type.String({ description: "End commit hash" }),
    }),

    async execute(_toolCallId, params, signal) {
      const { repo, from_commit, to_commit } = params as {
        repo: string;
        from_commit: string;
        to_commit: string;
      };

      const diffResult = await pi.exec(
        "git",
        ["-C", repo, "diff", `${from_commit}..${to_commit}`],
        { signal }
      );

      const files = parseDiff(diffResult.stdout || "");

      const output = JSON.stringify({
        from: from_commit,
        to: to_commit,
        files,
      });

      return {
        content: [{ type: "text", text: truncate(output) }],
      };
    },
  });
}
