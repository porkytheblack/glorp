import { theme, BANNER } from "../theme.ts";

export function Header({ width }: { width: number }) {
  const wide = width >= 60;
  return (
    <box flexDirection="column" alignItems="flex-start">
      {wide && BANNER.map((line, i) => (
        <text key={i} fg={theme.accent}>{line}</text>
      ))}
      <text fg={theme.text}>
        <span fg={theme.accent}>glorp</span> first-contact · let's get you wired in.
      </text>
      <text fg={theme.textMuted}>
        Pick a provider, drop in an API key, choose a model. Keys live at
        ~/.glorp/credentials.json (mode 0600).
      </text>
    </box>
  );
}
