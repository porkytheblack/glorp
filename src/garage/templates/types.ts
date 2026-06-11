/**
 * Setup template shapes — v2. A template describes everything a fresh
 * workspace needs: repos to clone (with pull-model git auth), predefined
 * skills, a workspace system prompt (materialised as `GLORP.md`, which the
 * agent's project-instruction discovery already folds into its prompt), MCP
 * providers to provision, and the original ordered shell/copy steps. String
 * values support `{param:NAME}` (from the create request, validated against
 * `params` declarations) and `{env:VAR}` (from the Garage process
 * environment) interpolation. v1 templates — bare `{name, steps}` — remain
 * valid: every v2 section is optional.
 */

export interface GitCloneStep {
  type: "git-clone";
  repo: string;
  /** Optional subdirectory to clone into (relative to the workspace). */
  dest?: string;
  /** Optional branch/tag to check out. */
  ref?: string;
}

export interface ShellStep {
  type: "shell";
  command: string;
}

export interface CopyStep {
  type: "copy";
  from: string;
  to: string;
}

export type TemplateStep = GitCloneStep | ShellStep | CopyStep;

/** A repo to clone, with optional auth via the configured git token service. */
export interface TemplateRepo {
  /** HTTPS clone URL (`https://github.com/owner/name[.git]`) — interpolatable. */
  url: string;
  /** Branch or tag. */
  ref?: string;
  /** Destination relative to the workspace; defaults to the repo name. */
  dest?: string;
  /**
   * `github` routes the clone through the garage's pull-model token service
   * and installs the `glorp __git-cred` credential helper in the clone so
   * fetch/push keep working after the provision-time token expires.
   * Default `none` (public clone).
   */
  auth?: "github" | "none";
}

/** A predefined skill copied from the template library directory. */
export interface TemplateSkillFrom {
  /** Directory under `<templatesDir>/` holding a SKILL.md (+ references). */
  from: string;
  /** Override the installed skill folder name; defaults to the source dirname. */
  name?: string;
}

/** A predefined skill authored inline in the template. */
export interface TemplateSkillInline {
  name: string;
  description?: string;
  /** Markdown body written as the skill's SKILL.md. */
  content: string;
}

/** One file of a registry-resolved skill. */
export interface TemplateSkillFile {
  /** Relative path inside the skill folder (must include a SKILL.md). */
  path: string;
  content: string;
}

/**
 * A multi-file skill RESOLVED by the template's source — the form the
 * companion-service registry emits (it inlines its own skill library
 * server-side, so Garage never fetches assets; spec §3.3).
 */
export interface TemplateSkillResolved {
  name: string;
  files: TemplateSkillFile[];
}

export type TemplateSkill = TemplateSkillFrom | TemplateSkillInline | TemplateSkillResolved;

/** An MCP provider provisioned into the workspace (mirrors ProvisionMcpInput). */
export interface TemplateMcpProvider {
  provider: string;
  url: string;
  identities?: Array<{ name: string; headers?: Record<string, string> }>;
  defaultIdentity?: string;
}

/** A declared template parameter — drives validation and client-side forms. */
export interface TemplateParamDecl {
  name: string;
  description?: string;
  required?: boolean;
  default?: string;
  /** Hint for clients to mask the input; values are always scrubbed from errors. */
  secret?: boolean;
}

export interface Template {
  name: string;
  description?: string;
  /** Ordered provisioning steps (v1 surface — still fully supported). */
  steps?: TemplateStep[];
  /** Repos cloned before any steps run. */
  repos?: TemplateRepo[];
  /** Skills installed into `<workspace>/.claude/skills/`. */
  skills?: TemplateSkill[];
  /** Written to `<workspace>/GLORP.md` — becomes the workspace system prompt. */
  system_prompt?: string;
  /** MCP providers provisioned after files land. */
  mcp?: TemplateMcpProvider[];
  /** Declared parameters; required ones are validated before provisioning. */
  params?: TemplateParamDecl[];
}

export class TemplateError extends Error {}
