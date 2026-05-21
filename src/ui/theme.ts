/**
 * Glorp's terminal palette. Acid greens for the alien half, cooler
 * indigos when the sleeper-tone leaks through.
 */
export const theme = {
  bg: "#0b0e14",
  bgPanel: "#11151c",
  bgAccent: "#161b24",
  border: "#2c3340",
  borderActive: "#5dd3a8",
  text: "#d6dde6",
  textMuted: "#6b7a8c",
  textDim: "#3f4a5a",
  accent: "#5dd3a8", // Glorp green
  accentSoft: "#3aa07b",
  user: "#7aa2f7", // Friend-shape blue
  system: "#e0af68", // Status orange
  error: "#f7768e",
  warning: "#ffb454",
  success: "#9ece6a",
  toolName: "#bb9af7", // Purple for tool calls
  toolOutput: "#838ba7",
  diffAdd: "#3a4a3a",
  diffAddText: "#9ece6a",
  diffDel: "#4a3a3a",
  diffDelText: "#f7768e",
  transmission: "#7dcfff", // Cyan — the buried signal
  transmissionHigh: "#ff79c6", // Pink — high-severity transmissions glitch through
} as const;

export const BANNER = [
  "  ▄████  ██▓     ▒█████   ██▀███   ██▓███  ",
  " ██▒ ▀█▒▓██▒    ▒██▒  ██▒▓██ ▒ ██▒▓██░  ██▒",
  "▒██░▄▄▄░▒██░    ▒██░  ██▒▓██ ░▄█ ▒▓██░ ██▓▒",
  "░▓█  ██▓▒██░    ▒██   ██░▒██▀▀█▄  ▒██▄█▓▒ ▒",
  "░▒▓███▀▒░██████▒░ ████▓▒░░██▓ ▒██▒▒██▒ ░  ░",
  " ░▒   ▒ ░ ▒░▓  ░░ ▒░▒░▒░ ░ ▒▓ ░▒▓░▒▓▒░ ░  ░",
  "  ░   ░ ░ ░ ▒  ░  ░ ▒ ▒░   ░▒ ░ ▒░░▒ ░     ",
  "░ ░   ░   ░ ░   ░ ░ ░ ▒    ░░   ░ ░░       ",
  "      ░     ░  ░    ░ ░     ░              ",
];

// Tiny ASCII glorp. Different mood = different face.
export const GLORP_AVATARS = {
  idle: ["  (•◡•)  ", "  / ▽ \\  ", "    -    "],
  thinking: ["  (•_•)? ", "  / ─ \\  ", "    -    "],
  working: ["  (>◡<)  ", "  /|▽|\\  ", "   ⌐ ⌐   "],
  speaking: ["  (◕ᴗ◕)  ", "  / ‿ \\  ", "    -    "],
  glitched: ["  [▓_▓]  ", "  / ▣ \\  ", "   //    "],
  error: ["  (×_×)  ", "  / x \\  ", "    -    "],
};
