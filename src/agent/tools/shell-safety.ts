/**
 * Shared guards for any code path that spawns a shell on behalf of the
 * LLM (the `bash` tool, fleet shell-fanout/edit-fanout). The blocklist is
 * best-effort — it stops the most common footguns and obvious prompt-
 * injection one-liners, but it is NOT a security boundary. Anything past
 * the prompt the model sees has to be assumed reachable; the real gate is
 * the user's per-call permission prompt.
 */

const DANGEROUS_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+\/(\s|$)/,
  /:\(\)\s*\{.*\}\s*;:/,
  /\bmkfs(\.\w+)?\b/,
  /\bdd\s+if=/,
  />+\s*\/dev\/(sd[a-z]|nvme\d+n\d+|vd[a-z]|xvd[a-z])/,
  /\btee\s+[^|]*\/dev\/(sd[a-z]|nvme\d+n\d+|vd[a-z]|xvd[a-z])/,
];

export function dangerousReason(cmd: string): string | null {
  for (const p of DANGEROUS_PATTERNS) {
    if (p.test(cmd)) return `Command matches a destructive pattern (${p}). Refusing.`;
  }
  return null;
}

/**
 * Build the env passed to a spawned shell. Strips anything that looks
 * like a secret (API keys, tokens, passwords) so an LLM-issued command
 * cannot `env` / `printenv` / `echo "$ANTHROPIC_API_KEY"` and ship the
 * value off the box. The agent process itself still has the secrets;
 * only its children are stripped.
 */
const SECRET_KEY_PATTERN = /(_API_KEY|_TOKEN|TOKEN_|SECRET|PASSWORD|PASSWD|PASSPHRASE|PRIVATE_KEY|CREDENTIALS|SESSION_KEY|AUTH)/i;

export function safeChildEnv(src: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(src)) {
    if (v == null) continue;
    if (SECRET_KEY_PATTERN.test(k)) continue;
    out[k] = v;
  }
  return out;
}
