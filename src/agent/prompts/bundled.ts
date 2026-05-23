import compaction from "./compaction.md" with { type: "text" };
import skillInstructions from "./skill-instructions.md" with { type: "text" };
import fleetResearch from "./agents/fleet-research.md" with { type: "text" };
import main from "./agents/main.md" with { type: "text" };
import planner from "./agents/planner.md" with { type: "text" };
import researcher from "./agents/researcher.md" with { type: "text" };
import reviewer from "./agents/reviewer.md" with { type: "text" };

export const BUNDLED_PROMPTS: Record<string, string> = {
  "agents/main.md": main,
  "agents/planner.md": planner,
  "agents/researcher.md": researcher,
  "agents/reviewer.md": reviewer,
  "agents/fleet-research.md": fleetResearch,
  "compaction.md": compaction,
  "skill-instructions.md": skillInstructions,
};
