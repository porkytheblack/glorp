/**
 * Workspace context discovery for spawned agents.
 * Reads config files to build a structured snapshot of the project environment
 * (package manager, language, commands, frameworks, directories) that gets
 * injected into agent system prompts.
 */
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";

export interface WorkspaceContext {
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | null;
  language: "typescript" | "javascript" | "python" | "go" | "rust" | null;
  framework: string | null;
  buildCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  typecheckCommand: string | null;
  srcDirs: string[];
  testDirs: string[];
  /** Short text block suitable for injection into agent system prompts. */
  promptBlock: string;
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const LOCKFILE_TO_PM: Record<string, WorkspaceContext["packageManager"]> = {
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
};

const FRAMEWORK_PACKAGES: [string, string][] = [
  ["next", "Next.js"], ["nuxt", "Nuxt"], ["@angular/core", "Angular"],
  ["svelte", "Svelte"], ["@sveltejs/kit", "SvelteKit"], ["express", "Express"],
  ["fastify", "Fastify"], ["hono", "Hono"], ["koa", "Koa"],
  ["@nestjs/core", "NestJS"], ["gatsby", "Gatsby"], ["remix", "Remix"],
  ["astro", "Astro"], ["vue", "Vue"], ["react", "React"],
];

const SRC_CANDIDATES = ["src", "lib", "app"] as const;
const TEST_CANDIDATES = ["tests", "test", "__tests__", "spec"] as const;

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf-8")) as T; } catch { return null; }
}

async function detectPackageManager(ws: string): Promise<WorkspaceContext["packageManager"]> {
  for (const [file, pm] of Object.entries(LOCKFILE_TO_PM)) {
    if (await exists(join(ws, file))) return pm;
  }
  if (await exists(join(ws, "package.json"))) return "npm";
  return null;
}

async function detectLanguage(ws: string): Promise<WorkspaceContext["language"]> {
  if (await exists(join(ws, "tsconfig.json"))) return "typescript";
  if (await exists(join(ws, "jsconfig.json"))) return "javascript";
  if (await exists(join(ws, "pyproject.toml")) || await exists(join(ws, "setup.py"))) {
    return "python";
  }
  if (await exists(join(ws, "go.mod"))) return "go";
  if (await exists(join(ws, "Cargo.toml"))) return "rust";
  if (await exists(join(ws, "package.json"))) return "javascript";
  return null;
}

function pickScript(scripts: Record<string, string>, ...keys: string[]): string | null {
  for (const key of keys) { if (scripts[key]) return scripts[key]; }
  return null;
}

function detectFramework(pkg: PackageJson): string | null {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [name, label] of FRAMEWORK_PACKAGES) { if (deps[name]) return label; }
  return null;
}

async function detectDirs(ws: string, candidates: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const dir of candidates) { if (await exists(join(ws, dir))) found.push(dir); }
  return found;
}

async function detectTypecheck(
  ws: string, scripts: Record<string, string>, lang: WorkspaceContext["language"],
): Promise<string | null> {
  const s = pickScript(scripts, "typecheck", "type-check", "check-types");
  if (s) return s;
  if (lang === "typescript") return "tsc --noEmit";
  if (lang === "python" && await exists(join(ws, "pyrightconfig.json"))) return "pyright";
  return null;
}

async function detectLint(ws: string, scripts: Record<string, string>): Promise<string | null> {
  const s = pickScript(scripts, "lint", "lint:fix");
  if (s) return s;
  const biome = await exists(join(ws, "biome.json")) || await exists(join(ws, "biome.jsonc"));
  if (biome) return "biome check .";
  const eslint = await exists(join(ws, ".eslintrc.json")) || await exists(join(ws, ".eslintrc.js"))
    || await exists(join(ws, "eslint.config.js")) || await exists(join(ws, "eslint.config.mjs"));
  if (eslint) return "eslint .";
  return null;
}

function runtimeLabel(pm: WorkspaceContext["packageManager"]): string {
  return pm === "bun" ? " (Bun runtime)" : "";
}

export function formatContextForPrompt(ctx: WorkspaceContext): string {
  const lines: string[] = ["## Project Environment"];
  if (ctx.language) {
    lines.push(`- Language: ${ctx.language}${runtimeLabel(ctx.packageManager)}`);
  }
  if (ctx.framework) lines.push(`- Framework: ${ctx.framework}`);
  if (ctx.packageManager) lines.push(`- Package manager: ${ctx.packageManager}`);
  if (ctx.buildCommand) lines.push(`- Build: \`${ctx.buildCommand}\``);
  if (ctx.testCommand) lines.push(`- Test: \`${ctx.testCommand}\``);
  if (ctx.lintCommand) lines.push(`- Lint: \`${ctx.lintCommand}\``);
  if (ctx.typecheckCommand) lines.push(`- Typecheck: \`${ctx.typecheckCommand}\``);
  if (ctx.srcDirs.length) lines.push(`- Source: ${ctx.srcDirs.join(", ")}/`);
  if (ctx.testDirs.length) lines.push(`- Tests: ${ctx.testDirs.join(", ")}/`);
  if (lines.length === 1) lines.push("- No project configuration detected");
  return lines.join("\n");
}

export async function discoverWorkspaceContext(workspace: string): Promise<WorkspaceContext> {
  const pkg = await readJson<PackageJson>(join(workspace, "package.json"));
  const scripts = pkg?.scripts ?? {};

  const [packageManager, language, srcDirs, testDirs] = await Promise.all([
    detectPackageManager(workspace),
    detectLanguage(workspace),
    detectDirs(workspace, SRC_CANDIDATES),
    detectDirs(workspace, TEST_CANDIDATES),
  ]);

  const framework = pkg ? detectFramework(pkg) : null;
  const buildCommand = pickScript(scripts, "build", "compile");
  const testCommand = pickScript(scripts, "test", "test:unit", "test:all");
  const [lintCommand, typecheckCommand] = await Promise.all([
    detectLint(workspace, scripts),
    detectTypecheck(workspace, scripts, language),
  ]);

  const ctx: WorkspaceContext = {
    packageManager,
    language,
    framework,
    buildCommand,
    testCommand,
    lintCommand,
    typecheckCommand,
    srcDirs,
    testDirs,
    promptBlock: "",
  };
  ctx.promptBlock = formatContextForPrompt(ctx);
  return ctx;
}
