/**
 * Classify model/provider failures into something a human can act on. The
 * raw error (message + stack) stays available as collapsed detail; the
 * classification drives the headline, the hint, and the recovery action the
 * UI offers — instead of a red stack trace and a shrug.
 */

export type ErrorKind = "config" | "auth" | "modality" | "rate_limit" | "quota" | "network" | "upstream" | "internal";

export interface ClassifiedError {
  kind: ErrorKind;
  /** Human headline, e.g. "The provider rejected the API key". */
  title: string;
  /** One actionable sentence, e.g. "Update the key under Models". */
  hint: string;
  /** Seconds until a rate limit window resets, when the provider said so. */
  retryAfterSec?: number;
}

const STATUS_RE = /\b(401|403|408|429|5\d{2})\b/;

export function classifyModelError(err: unknown): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err);
  const status =
    (typeof (err as { status?: number })?.status === "number" && (err as { status: number }).status) ||
    Number(message.match(STATUS_RE)?.[1] ?? 0);
  const lower = message.toLowerCase();

  if (/no model configured|no api key|no provider configured|requires a model/.test(lower)) {
    return {
      kind: "config",
      title: "No model is configured yet",
      hint: "Add a provider and a model under Models, then send the message again.",
    };
  }

  if (/no endpoints found that support image|does not support image|image input is not supported|unsupported image|multimodal.*not support/.test(lower)) {
    return {
      kind: "modality",
      title: "The model can't see images",
      hint: "Remove the attachment, or switch to a vision-capable model — look for the eye badge in the model picker.",
    };
  }

  if (status === 401 || status === 403 || /invalid api key|invalid authentication|unauthorized|forbidden/.test(lower)) {
    return {
      kind: "auth",
      title: "The provider rejected the API key",
      hint: "The key may be expired, revoked, or for a different endpoint. Update it under Models, then re-pick the model in this session.",
    };
  }

  if (status === 429 || /rate limit|too many requests|tpd|tpm|quota/.test(lower)) {
    const retryAfterSec = readRetryAfter(err, message);
    const quota = /tpd|daily|quota/.test(lower);
    return {
      kind: quota ? "quota" : "rate_limit",
      title: quota ? "Provider daily quota reached" : "Provider rate limit hit",
      hint: retryAfterSec
        ? `The provider asked to retry in ~${formatDuration(retryAfterSec)}. Switch this session to another model to keep working now.`
        : "Wait for the window to reset, or switch this session to another model.",
      ...(retryAfterSec ? { retryAfterSec } : {}),
    };
  }

  if (/fetch failed|econnrefused|enotfound|etimedout|socket|network|dns/.test(lower) || status === 408) {
    return {
      kind: "network",
      title: "Could not reach the provider",
      hint: "Check the provider's base URL under Models and your network connection.",
    };
  }

  if (status >= 500 || /bad gateway|service unavailable|overloaded|internal server error/.test(lower)) {
    return {
      kind: "upstream",
      title: "The provider had an internal error",
      hint: "This is on the provider's side — retrying usually works. If it persists, switch models.",
    };
  }

  if (status === 400 || /invalid request|must be followed|reasoning_content|not found in/.test(lower)) {
    return {
      kind: "upstream",
      title: "The provider rejected the request",
      hint: "Send the message again — the session history is repaired automatically before each turn.",
    };
  }

  return {
    kind: "internal",
    title: "Something went wrong in the agent",
    hint: "Try again; if it persists, check the session error log.",
  };
}

function readRetryAfter(err: unknown, message: string): number | undefined {
  const headers = (err as { headers?: { get?: (k: string) => string | null } })?.headers;
  const fromHeader = headers?.get?.("retry-after");
  const fromMessage = message.match(/retry[- ]after[:\s]+(\d+)/i)?.[1];
  const n = Number(fromHeader ?? fromMessage);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function formatDuration(sec: number): string {
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 5400) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}
