/** Glorp's terminal palette. Quiet chrome with semantic status accents. */
export const theme = {
  bg: "#0b0e14",
  bgPanel: "#11151c",
  bgAccent: "#161b24",
  border: "#2c3340",
  borderActive: "#5dd3a8",
  text: "#d6dde6",
  textMuted: "#6b7a8c",
  textDim: "#3f4a5a",
  accent: "#5dd3a8",
  accentSoft: "#3aa07b",
  user: "#7aa2f7",
  system: "#e0af68",
  error: "#f7768e",
  warning: "#ffb454",
  success: "#9ece6a",
  toolName: "#bb9af7",
  toolOutput: "#838ba7",
  diffAdd: "#3a4a3a",
  diffAddText: "#9ece6a",
  diffDel: "#4a3a3a",
  diffDelText: "#f7768e",
  transmission: "#7dcfff",
  transmissionHigh: "#ff79c6",
  agent: "#c0a0ff",
  loopActive: "#7dcfff",
  dimOverlay: "#0b0e14",
  // Menu / overlay primitives (Helix-style command palette & pickers).
  match: "#7dcfff",       // dim highlight on fuzzy-matched characters
  menuSel: "#5dd3a8",     // selected-row background fill
  menuSelText: "#0b0e14", // selected-row foreground (on menuSel)
  footer: "#6b7a8c",      // footer key-hint row text
} as const;

export const BANNER = [
  "  ▄████  ██▓     ▒█████   ██▀███   ██▓███  ",
  " ██▒ ▀█▒▓██▒    ▒██▒  ██▒▓██ ▒ ██▒▓██░  ██▒",
  "▒██░▄▄▄░▒██░    ▒██░  ██▒▓██ ░▄█ ▒▓██░ ██▓▒",
  "░▓█  ██▓▒██░    ▒██   ██░▒██▀▀█▄  ▒██▄█▓▒ ▒",
  "░▒▓███▀▒░██████▒░ ████▓▒░░██▓ ▒██▒▒██▒ ░  ░",
  " ░▒   ▒ ░ ▒░▓  ░░ ▒░▒░▒░ ░ ▒▓ ░▒▓░░▒▓▒░ ░  ░",
  "  ░   ░ ░ ░ ▒  ░  ░ ▒ ▒░   ░▒ ░ ▒░░▒ ░     ",
  "░ ░   ░   ░ ░   ░ ░ ▒    ░░   ░ ░░       ",
  "      ░     ░  ░    ░ ░     ░              ",
];

export const GLORP_AVATARS = {
  idle: ["  (•◡•)  ", "  / ▽ \\  ", "    -    "],
  thinking: ["  (•_•)? ", "  / ─ \\  ", "    -    "],
  working: ["  (>◡<)  ", "  /|▽|\\  ", "   ⌐ ⌐   "],
  speaking: ["  (◕ᴗ◕)  ", "  / ‿ \\  ", "    -    "],
  glitched: ["  [▓_▓]  ", "  / ▣ \\  ", "   //    "],
  error: ["  (×_×)  ", "  / x \\  ", "    -    "],
};
