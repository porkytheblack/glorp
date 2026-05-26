import compaction from "./compaction.md" with { type: "text" };
import skillInstructions from "./skill-instructions.md" with { type: "text" };
import main from "./agents/main.md" with { type: "text" };
import planner from "./agents/planner.md" with { type: "text" };
import researcher from "./agents/researcher.md" with { type: "text" };
import reviewer from "./agents/reviewer.md" with { type: "text" };
import generator from "./agents/generator.md" with { type: "text" };
import evaluator from "./agents/evaluator.md" with { type: "text" };
import builder from "./agents/builder.md" with { type: "text" };

export const BUNDLED_PROMPTS: Record<string, string> = {
  "agents/main.md": main,
  "agents/planner.md": planner,
  "agents/researcher.md": researcher,
  "agents/reviewer.md": reviewer,
  "agents/generator.md": generator,
  "agents/evaluator.md": evaluator,
  "agents/builder.md": builder,
  "compaction.md": compaction,
  "skill-instructions.md": skillInstructions,
};
