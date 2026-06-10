import type { Message, ModelAdapter } from "glove-core/core";
import { isVisibleTranscriptMessage, visibleMessageText } from "./model-guards.ts";
import { isPleasantry } from "../store-snapshot.ts";

const TITLE_MAX_MESSAGES = 10;
const TITLE_MAX_CHARS_PER_MESSAGE = 700;

export function cleanSessionTitle(raw: string): string | null {
  let title = raw.replace(/\r/g, "\n").split("\n").find((line) => line.trim()) ?? "";
  title = title
    .replace(/^title\s*:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return null;
  if (title.length > 60) title = title.slice(0, 60).replace(/\s+\S*$/, "").trim();
  return title || null;
}

export async function generateSessionTitle(
  model: ModelAdapter,
  messages: Message[],
  signal?: AbortSignal,
): Promise<string | null> {
  const visible = messages.filter(isVisibleTranscriptMessage);
  if (!visible.some((m) => m.sender === "user")) return null;
  // Skip the leading pleasantry exchange ("hey" / "How can I help?") so the
  // title reflects the actual ask, not the greeting.
  let start = 0;
  while (start < visible.length) {
    const m = visible[start]!;
    if (m.sender === "user" && !isPleasantry(visibleMessageText(m))) break;
    start++;
  }
  if (start >= visible.length) start = 0; // all pleasantries — title the chat anyway
  const transcript = visible
    .slice(start, start + TITLE_MAX_MESSAGES)
    .map((m) => `${m.sender === "user" ? "User" : "Assistant"}: ${truncate(visibleMessageText(m))}`)
    .join("\n");
  const result = await model.prompt({
    messages: [{
      sender: "user",
      text:
        "Generate a concise chat title for this coding conversation.\n" +
        "Rules: return only the title, no quotes, no markdown, no trailing punctuation, 3-7 words, max 60 characters.\n\n" +
        transcript,
    }],
  }, async () => {}, signal);
  return cleanSessionTitle(result.messages.at(-1)?.text ?? "");
}

function truncate(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= TITLE_MAX_CHARS_PER_MESSAGE
    ? clean
    : `${clean.slice(0, TITLE_MAX_CHARS_PER_MESSAGE - 1)}...`;
}
