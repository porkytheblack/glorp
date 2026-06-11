import type { TemplateStep } from "./types";

const TOKEN = /\{(param|env):([A-Za-z0-9_]+)\}/g;

/** Unique `{param:NAME}` names referenced anywhere in a template's steps. */
export function templateParams(steps: TemplateStep[]): string[] {
  const names = new Set<string>();
  const scan = (s?: string) => {
    if (!s) return;
    TOKEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN.exec(s))) if (m[1] === "param") names.add(m[2]);
  };
  for (const step of steps) {
    if (step.type === "git-clone") {
      scan(step.repo);
      scan(step.dest);
      scan(step.ref);
    } else if (step.type === "shell") {
      scan(step.command);
    } else if (step.type === "copy") {
      scan(step.from);
      scan(step.to);
    }
  }
  return [...names];
}

/** One-line, human description of a step. */
export function stepSummary(step: TemplateStep): string {
  if (step.type === "git-clone") return `Clone ${step.repo}${step.ref ? ` @ ${step.ref}` : ""}${step.dest ? ` → ${step.dest}` : ""}`;
  if (step.type === "shell") return step.command;
  return `Copy ${step.from} → ${step.to}`;
}
