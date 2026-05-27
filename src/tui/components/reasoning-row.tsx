import React from "react";

const REASONING_COLOR = "#8a8a8a";
const REASONING_BORDER = "#555555";

export function ReasoningRow({ text }: { text: string }) {
  const lines = text.split("\n");
  const preview = lines.length > 20
    ? [...lines.slice(0, 18), `  ... ${lines.length - 18} more lines`]
    : lines;
  return (
    <box flexDirection="column" marginBottom={1} paddingLeft={2}>
      <text fg={REASONING_BORDER}>{"--- reasoning trace ---"}</text>
      {preview.map((line, i) => (
        <text key={i} fg={REASONING_COLOR}>{line || " "}</text>
      ))}
      <text fg={REASONING_BORDER}>{"--- end reasoning ---"}</text>
    </box>
  );
}
