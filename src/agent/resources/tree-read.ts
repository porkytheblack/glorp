import {
  ResourceFsError,
  isWithin,
  matchGlob,
  normalisePath,
  parentDir,
} from "glove-memory";
import type { DirectoryEntry, GrepMatch, GrepSpec, ResourceFile, ResourceStat } from "glove-memory";
import type { ResourceTree } from "./state.ts";
import { cloneFile, dirEntry, fileEntry, replaceText, statDir, statFile, textOf } from "./util.ts";

export function listResources(
  tree: ResourceTree,
  input: string,
  opts: { recursive?: boolean; limit?: number } = {},
): DirectoryEntry[] {
  const root = normalisePath(input);
  if (!dirExists(tree, root)) {
    if (tree.files.has(root)) throw new ResourceFsError("not_a_directory", `${root} is a file.`);
    throw new ResourceFsError("path_not_found", `Directory not found: ${root}.`);
  }
  const entries = new Map<string, DirectoryEntry>();
  for (const file of tree.files.values()) addListEntry(entries, root, file.path, fileEntry(file), opts.recursive);
  for (const dir of tree.dirs) addListEntry(entries, root, dir, dirEntry(dir), opts.recursive);
  let out = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

export function readResource(
  tree: ResourceTree,
  input: string,
  opts: { range?: [number, number] } = {},
): ResourceFile {
  const p = normalisePath(input);
  const file = tree.files.get(p);
  if (!file) {
    if (dirExists(tree, p)) throw new ResourceFsError("not_a_file", `${p} is a directory.`);
    throw new ResourceFsError("path_not_found", `File not found: ${p}.`);
  }
  const [start, end] = opts.range ?? [1, 50];
  if (start < 1 || (end !== -1 && end < start)) throw new ResourceFsError("invalid_range", "Invalid line range.");
  const text = textOf(file.body);
  if (text === null) return cloneFile(file);
  const lines = text.split("\n");
  const sliced = start - 1 >= lines.length ? "" : lines.slice(start - 1, end === -1 ? lines.length : end).join("\n");
  return cloneFile(file, replaceText(file.body, sliced));
}

export function statResource(tree: ResourceTree, input: string): ResourceStat | null {
  const p = normalisePath(input);
  const file = tree.files.get(p);
  if (file) return statFile(file);
  return dirExists(tree, p) ? statDir(p) : null;
}

export function existsResource(tree: ResourceTree, input: string): boolean {
  const p = normalisePath(input);
  return tree.files.has(p) || dirExists(tree, p);
}

export function grepResources(tree: ResourceTree, spec: GrepSpec): GrepMatch[] {
  const root = spec.path ? normalisePath(spec.path) : "/";
  const types = spec.contentTypes ? new Set(spec.contentTypes) : null;
  const regex = makeRegex(spec);
  const out: GrepMatch[] = [];
  for (const file of tree.files.values()) {
    if (!isWithin(root, file.path) || (types && !types.has(file.body.type))) continue;
    const text = textOf(file.body);
    if (text === null) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      if (!regex.test(lines[i]!)) continue;
      const n = spec.contextLines ?? 2;
      out.push({
        path: file.path,
        line: i + 1,
        text: lines[i]!,
        context: { before: lines.slice(Math.max(0, i - n), i), after: lines.slice(i + 1, i + 1 + n) },
      });
      if (spec.limit && out.length >= spec.limit) return out;
    }
  }
  return out;
}

export function globResources(
  tree: ResourceTree,
  pattern: string,
  opts: { path?: string; limit?: number } = {},
): string[] {
  const root = opts.path ? normalisePath(opts.path) : "/";
  const out = [...tree.files.keys()].filter((p) => isWithin(root, p) && matchGlob(pattern, p)).sort();
  return opts.limit ? out.slice(0, opts.limit) : out;
}

export function dirExists(tree: ResourceTree, p: string): boolean {
  return p === "/" || tree.dirs.has(p) || [...tree.files.keys()].some((key) => isWithin(p, key) && key !== p);
}

function addListEntry(
  entries: Map<string, DirectoryEntry>,
  root: string,
  target: string,
  entry: DirectoryEntry,
  recursive = false,
): void {
  if (!isWithin(root, target) || target === root) return;
  if (recursive) return void entries.set(target, entry);
  const pd = parentDir(target);
  if (pd === root) return void entries.set(target, entry);
  if (!isWithin(root, pd)) return;
  const child = pd.slice(root === "/" ? 1 : root.length + 1).split("/")[0];
  const dirPath = root === "/" ? `/${child}` : `${root}/${child}`;
  entries.set(dirPath, dirEntry(dirPath));
}

function makeRegex(spec: GrepSpec): RegExp {
  if (spec.regex) return new RegExp(spec.query, spec.caseSensitive ? "" : "i");
  return new RegExp(spec.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), spec.caseSensitive ? "" : "i");
}
