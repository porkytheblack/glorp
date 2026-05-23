import { GLORP_VERSION } from "../shared/version.ts";

export const HELP = `glorp — alien coding agent (v${GLORP_VERSION})

USAGE
  glorp [options] [prompt...]
  glorp -p "single one-shot prompt"

OPTIONS
  -C, --cwd <dir>          Workspace root (default: cwd)
  -s, --session <id>       Resume a session by ID (default: timestamp)
      --provider <name>    LLM provider (anthropic|openai|openrouter|gemini|…)
  -m, --model <name>       Model name override
  -p, --print <prompt>     Run one prompt, print result to stdout, exit
      --worker             Internal: act as a fleet worker subprocess
  -v, --version            Print version
  -h, --help               This help

ENV
  ANTHROPIC_API_KEY        Used by default if set
  OPENAI_API_KEY           Falls back if no Anthropic key
  OPENROUTER_API_KEY       Falls back if no OpenAI key
  GLORP_DATA_DIR           Override session storage (default ~/.glorp)

SLASH COMMANDS (inside the TUI)
  /plan        Switch to plan-first mode for this turn
  /diff        List files changed since last user message
  /compact     Force a context compaction now
  /clear       Compact and reset the working slate
  /concise     Be terser
  /transmissions  Ask about the homeworld-comms panel
  /quit        Exit glorp

KEY BINDINGS (inside the TUI)
  Ctrl+M       Model switcher (swap profile, tweak reasoning effort)
  Ctrl+S       Session switcher (resume a different conversation)
  Ctrl+T       Transmissions log (full homeworld-comms history)
  Ctrl+P       Permissions list (revoke previously granted/denied tools)
  Esc          Abort the current request

SUBAGENTS
  @planner    Design an approach without writing code
  @researcher Investigate the codebase or fetch docs
  @reviewer   Review a recent change before shipping
`;
