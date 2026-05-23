import { ResourceFsError, isWithin, normalisePath, parentDir } from "glove-memory";
import type { Provenance, ResourceBody, ResourceFile, ResourceMetadata } from "glove-memory";
import type { ResourceTree } from "./state.ts";
import { dirExists } from "./tree-read.ts";
import {
  cloneBody,
  cloneFile,
  movedProvenance,
  normaliseMetadata,
  replaceText,
  requireProvenance,
  rootSemanticDisabled,
  textOf,
  validateBody,
} from "./util.ts";

export function writeResource(
  tree: ResourceTree,
  input: string,
  body: ResourceBody,
  metadata: ResourceMetadata,
  provenance: Provenance,
): void {
  requireProvenance(provenance);
  validateBody(body);
  const p = normalisePath(input);
  if (dirExists(tree, p)) throw new ResourceFsError("not_a_file", `${p} is a directory.`);
  const now = new Date().toISOString();
  const existing = tree.files.get(p);
  tree.files.set(p, {
    path: p,
    body: cloneBody(body),
    metadata: normaliseMetadata(metadata),
    embeddingStatus: rootSemanticDisabled(tree.schema, p) ? "fresh" : existing ? "stale" : "missing",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    provenance: existing ? [...existing.provenance, provenance] : [provenance],
  });
  pruneParentDirs(tree, p);
}

export function editResource(
  tree: ResourceTree,
  input: string,
  oldStr: string,
  newStr: string,
  provenance: Provenance,
): void {
  requireProvenance(provenance);
  const p = normalisePath(input);
  const file = requireFile(tree, p);
  const text = textOf(file.body);
  if (text === null) throw new ResourceFsError("body_not_editable", `${p} has no editable text.`);
  const idx = text.indexOf(oldStr);
  if (idx === -1) throw new ResourceFsError("edit_string_not_found", `oldStr not found in ${p}.`);
  if (text.indexOf(oldStr, idx + 1) !== -1) throw new ResourceFsError("edit_string_not_unique", `oldStr is not unique in ${p}.`);
  file.body = replaceText(file.body, text.slice(0, idx) + newStr + text.slice(idx + oldStr.length));
  touch(tree, file, provenance);
}

export function mkdirResource(tree: ResourceTree, input: string, provenance: Provenance): void {
  requireProvenance(provenance);
  const p = normalisePath(input);
  if (tree.files.has(p)) throw new ResourceFsError("path_already_exists", `File exists at ${p}.`);
  if (p !== "/" && !dirExists(tree, p)) tree.dirs.add(p);
}

export function moveResource(tree: ResourceTree, fromInput: string, toInput: string, provenance: Provenance): void {
  requireProvenance(provenance);
  const from = normalisePath(fromInput);
  const to = normalisePath(toInput);
  if (from === to) return;
  if (tree.files.has(to) || tree.dirs.has(to)) throw new ResourceFsError("path_already_exists", `Destination exists: ${to}.`);
  const file = tree.files.get(from);
  if (file) return void moveFile(tree, from, to, file, provenance);
  if (!dirExists(tree, from)) throw new ResourceFsError("path_not_found", `Path not found: ${from}.`);
  for (const [key, child] of [...tree.files.entries()]) {
    if (isWithin(from, key)) moveFile(tree, key, to + key.slice(from.length), child, provenance);
  }
  for (const dir of [...tree.dirs]) {
    if (!isWithin(from, dir)) continue;
    tree.dirs.delete(dir);
    if (dir !== from) tree.dirs.add(to + dir.slice(from.length));
  }
  tree.dirs.delete(from);
  tree.dirs.add(to);
}

export function removeResource(tree: ResourceTree, input: string, recursive: boolean, provenance: Provenance): void {
  requireProvenance(provenance);
  const p = normalisePath(input);
  if (tree.files.delete(p)) return;
  if (!dirExists(tree, p)) throw new ResourceFsError("path_not_found", `Path not found: ${p}.`);
  const hasChildren = [...tree.files.keys()].some((k) => isWithin(p, k) && k !== p);
  if (!recursive && hasChildren) throw new ResourceFsError("directory_not_empty", `${p} is not empty.`);
  for (const key of [...tree.files.keys()]) if (isWithin(p, key) && key !== p) tree.files.delete(key);
  for (const dir of [...tree.dirs]) if (isWithin(p, dir)) tree.dirs.delete(dir);
}

export function setMetadataResource(tree: ResourceTree, input: string, patch: Partial<ResourceMetadata>, provenance: Provenance): void {
  requireProvenance(provenance);
  const file = requireFile(tree, normalisePath(input));
  file.metadata = normaliseMetadata({ ...file.metadata, ...patch });
  touch(tree, file, provenance, false);
}

export function linksForResources(tree: ResourceTree, targetKind: "entity" | "episode" | "resource", targetId: string): string[] {
  return [...tree.files.values()]
    .filter((f) => f.metadata.links.some((l) => l.kind === targetKind && l.id === targetId))
    .map((f) => f.path)
    .sort();
}

export function replaceLinkTargets(
  tree: ResourceTree,
  fromKind: "entity" | "episode" | "resource",
  fromId: string,
  toId: string,
  provenance: Provenance,
): { updated: number } {
  requireProvenance(provenance);
  let updated = 0;
  for (const file of tree.files.values()) {
    let touched = false;
    file.metadata.links = file.metadata.links.map((link) => {
      if (link.kind !== fromKind || link.id !== fromId) return link;
      touched = true;
      return { ...link, id: toId };
    });
    if (touched) {
      touch(tree, file, { ...provenance, note: provenance.note ? `${provenance.note}; rewrote link` : "rewrote link" }, false);
      updated++;
    }
  }
  return { updated };
}

function requireFile(tree: ResourceTree, p: string): ResourceFile {
  const file = tree.files.get(p);
  if (!file) throw new ResourceFsError("path_not_found", `File not found: ${p}.`);
  return file;
}

function touch(tree: ResourceTree, file: ResourceFile, provenance: Provenance, stale = true): void {
  file.updatedAt = new Date().toISOString();
  file.provenance.push(provenance);
  if (stale && !rootSemanticDisabled(tree.schema, file.path)) file.embeddingStatus = "stale";
}

function pruneParentDirs(tree: ResourceTree, p: string): void {
  tree.dirs.delete(p);
  for (let pd = parentDir(p); pd !== "/"; pd = parentDir(pd)) tree.dirs.delete(pd);
}

function moveFile(tree: ResourceTree, from: string, to: string, file: ResourceFile, provenance: Provenance): void {
  tree.files.delete(from);
  tree.files.set(to, { ...cloneFile(file), path: to, updatedAt: new Date().toISOString(), provenance: [...file.provenance, movedProvenance(provenance, from)] });
}
