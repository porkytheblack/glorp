/**
 * Setup template shapes. A template is an ordered list of provisioning steps
 * that run sequentially in a fresh workspace directory. Values support
 * `{param:NAME}` (from the create-session request) and `{env:VAR}` (from the
 * Garage process environment) interpolation.
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

export interface Template {
  name: string;
  description?: string;
  steps: TemplateStep[];
}

export class TemplateError extends Error {}
