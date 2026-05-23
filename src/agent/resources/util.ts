import {
  MemoryWriteError,
  ResourceFsError,
  basename,
  bodySize,
  isWithin,
  searchableText,
} from "glove-memory";
import type {
  DirectoryEntry,
  MemorySchema,
  Provenance,
  ResourceBody,
  ResourceFile,
  ResourceMetadata,
  ResourceStat,
} from "glove-memory";

export function fileEntry(file: ResourceFile): DirectoryEntry {
  return {
    name: basename(file.path),
    path: file.path,
    kind: "file",
    contentType: file.body.type,
    size: bodySize(file.body),
    summary: file.metadata.summary,
    tags: file.metadata.tags.length ? [...file.metadata.tags] : undefined,
    updatedAt: file.updatedAt,
  };
}

export function dirEntry(path: string): DirectoryEntry {
  return { name: basename(path), path, kind: "directory" };
}

export function cloneFile(file: ResourceFile, body?: ResourceBody): ResourceFile {
  return {
    ...file,
    body: cloneBody(body ?? file.body),
    metadata: cloneMetadata(file.metadata),
    provenance: file.provenance.map((p) => ({ ...p })),
  };
}

export function cloneBody(body: ResourceBody): ResourceBody {
  return body.type === "url" ? { ...body } : { ...body };
}

export function cloneMetadata(m: ResourceMetadata): ResourceMetadata {
  const tags = Array.isArray(m?.tags) ? m.tags : [];
  const links = Array.isArray(m?.links) ? m.links : [];
  return {
    ...m,
    tags: [...tags],
    links: links.map((l) => ({ ...l })),
  };
}

export function normaliseMetadata(m?: Partial<ResourceMetadata>): ResourceMetadata {
  return {
    ...m,
    tags: Array.isArray(m?.tags) ? [...m.tags] : [],
    links: Array.isArray(m?.links) ? m.links.map((l) => ({ ...l })) : [],
  };
}

export function replaceText(body: ResourceBody, text: string): ResourceBody {
  if (body.type === "text") return { type: "text", text };
  if (body.type === "markdown") return { type: "markdown", text };
  return { type: "url", url: body.url, cachedText: text };
}

export function statFile(file: ResourceFile): ResourceStat {
  return {
    path: file.path,
    kind: "file",
    contentType: file.body.type,
    size: bodySize(file.body),
    metadata: cloneMetadata(file.metadata),
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

export function statDir(path: string): ResourceStat {
  const zero = new Date(0).toISOString();
  return { path, kind: "directory", createdAt: zero, updatedAt: zero };
}

export function validateBody(body: ResourceBody): void {
  if (!body || typeof body !== "object") {
    throw new ResourceFsError("binary_not_supported", "Body must be text, markdown, or url.");
  }
  if ((body.type === "text" || body.type === "markdown") && typeof body.text === "string") return;
  if (body.type === "url" && typeof body.url === "string" && body.url.length > 0) return;
  throw new ResourceFsError("binary_not_supported", `Invalid resource body type: ${body.type}.`);
}

export function requireProvenance(p: Provenance): void {
  if (!p?.source || !p?.actor || !p?.timestamp) {
    throw new MemoryWriteError("provenance_required", "A provenance record is required.");
  }
}

export function textOf(body: ResourceBody): string | null {
  return searchableText(body);
}

export function movedProvenance(p: Provenance, from: string): Provenance {
  const note = p.note ? `${p.note}; moved from ${from}` : `moved from ${from}`;
  return { ...p, note };
}

export function rootSemanticDisabled(schema: MemorySchema, path: string): boolean {
  return schema.listResourceRoots().some((root) => isWithin(root.path, path) && root.semanticSearch === false);
}

export function safeFilePart(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "default";
}
