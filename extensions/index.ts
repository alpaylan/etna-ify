import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerGitTools } from "./tools/git";
import { registerMaraudersTools } from "./tools/marauders";
import { registerTestTools } from "./tools/test";
import { registerCheckpointTools } from "./tools/checkpoint";
import { registerPipelineTools } from "./tools/pipeline";
import { loadState } from "./orchestrator";
import { STAGE_GUIDANCE } from "./constants";

export default function (pi: ExtensionAPI) {
  registerGitTools(pi);
  registerMaraudersTools(pi);
  registerTestTools(pi);
  registerCheckpointTools(pi);
  registerPipelineTools(pi);

  // Inject pipeline context into the system prompt when a run is active
  pi.on("before_agent_start", async (event) => {
    // Look for state files in the current working directory
    const state = await loadState(process.cwd());
    if (!state || state.status !== "running" || !state.current_stage) {
      return {};
    }

    const stage = state.current_stage;
    const guidance = STAGE_GUIDANCE[stage as keyof typeof STAGE_GUIDANCE] ?? "";

    const addition = [
      "",
      "## ETNA Pipeline Context",
      `- Run ID: ${state.run_id}`,
      `- Project: ${state.project}`,
      `- Current Stage: ${stage}`,
      `- Completed Stages: ${state.completed_stages.join(", ") || "(none)"}`,
      `- Stage Guidance: ${guidance}`,
      "",
      "Prior checkpoint data is available via etna_checkpoint_read.",
      `Load the skill for this stage with: /etna-${stage}`,
    ].join("\n");

    return { systemPrompt: event.systemPrompt + addition };
  });
}
