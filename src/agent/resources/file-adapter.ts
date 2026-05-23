import * as path from "node:path";
import type {
  DirectoryEntry,
  GrepMatch,
  GrepSpec,
  MemorySchema,
  Provenance,
  ResourceBody,
  ResourceFile,
  ResourceFsAdapter,
  ResourceMetadata,
  ResourceStat,
} from "glove-memory";
import { normalisePath } from "glove-memory";
import { readResourceState, writeResourceState } from "./state.ts";
import type { ResourceTree } from "./state.ts";
import { safeFilePart, cloneFile } from "./util.ts";
import {
  existsResource,
  globResources,
  grepResources,
  listResources,
  readResource,
  statResource,
} from "./tree-read.ts";
import {
  editResource,
  linksForResources,
  mkdirResource,
  moveResource,
  removeResource,
  replaceLinkTargets,
  setMetadataResource,
  writeResource,
} from "./tree-write.ts";

interface FileResourcesOptions {
  dataDir: string;
  sessionId: string;
  schema: MemorySchema;
  identifier?: string;
}

export class FileResourcesAdapter implements ResourceFsAdapter, ResourceTree {
  identifier: string;
  schema: MemorySchema;
  supportsSemanticSearch = false;
  files = new Map<string, ResourceFile>();
  dirs = new Set<string>();
  private ready: Promise<void>;
  private queue = Promise.resolve();
  private filePath: string;

  constructor(opts: FileResourcesOptions) {
    this.schema = opts.schema;
    this.identifier = opts.identifier ?? `glorp-resources:${opts.sessionId}`;
    this.filePath = path.join(opts.dataDir, "sessions", `${safeFilePart(opts.sessionId)}.resources.json`);
    this.ready = this.load();
  }

  async list(input: string, opts?: { recursive?: boolean; limit?: number }): Promise<DirectoryEntry[]> {
    await this.ready;
    return listResources(this, input, opts);
  }

  async read(input: string, opts?: { range?: [number, number] }): Promise<ResourceFile> {
    await this.ready;
    return readResource(this, input, opts);
  }

  async stat(input: string): Promise<ResourceStat | null> {
    await this.ready;
    return statResource(this, input);
  }

  async exists(input: string): Promise<boolean> {
    await this.ready;
    return existsResource(this, input);
  }

  async grep(spec: GrepSpec): Promise<GrepMatch[]> {
    await this.ready;
    return grepResources(this, spec);
  }

  async glob(pattern: string, opts?: { path?: string; limit?: number }): Promise<string[]> {
    await this.ready;
    return globResources(this, pattern, opts);
  }

  async write(input: string, body: ResourceBody, metadata: ResourceMetadata, provenance: Provenance): Promise<void> {
    await this.ready;
    writeResource(this, input, body, metadata, provenance);
    await this.save();
  }

  async edit(input: string, oldStr: string, newStr: string, provenance: Provenance): Promise<void> {
    await this.ready;
    editResource(this, input, oldStr, newStr, provenance);
    await this.save();
  }

  async mkdir(input: string, provenance: Provenance): Promise<void> {
    await this.ready;
    mkdirResource(this, input, provenance);
    await this.save();
  }

  async move(fromPath: string, toPath: string, provenance: Provenance): Promise<void> {
    await this.ready;
    moveResource(this, fromPath, toPath, provenance);
    await this.save();
  }

  async remove(input: string, recursive: boolean, provenance: Provenance): Promise<void> {
    await this.ready;
    removeResource(this, input, recursive, provenance);
    await this.save();
  }

  async setMetadata(input: string, patch: Partial<ResourceMetadata>, provenance: Provenance): Promise<void> {
    await this.ready;
    setMetadataResource(this, input, patch, provenance);
    await this.save();
  }

  async linksFor(targetKind: "entity" | "episode" | "resource", targetId: string): Promise<string[]> {
    await this.ready;
    return linksForResources(this, targetKind, targetId);
  }

  async replaceLinkTarget(
    fromKind: "entity" | "episode" | "resource",
    fromId: string,
    toId: string,
    provenance: Provenance,
  ): Promise<{ updated: number }> {
    await this.ready;
    const result = replaceLinkTargets(this, fromKind, fromId, toId, provenance);
    if (result.updated) await this.save();
    return result;
  }

  private async load(): Promise<void> {
    const state = await readResourceState(this.filePath);
    for (const dir of state.dirs) this.dirs.add(normalisePath(dir));
    for (const file of state.files) this.files.set(normalisePath(file.path), cloneFile(file));
  }

  private async save(): Promise<void> {
    this.queue = this.queue.catch(() => undefined).then(() =>
      writeResourceState(this.filePath, {
        dirs: [...this.dirs].sort(),
        files: [...this.files.values()].sort((a, b) => a.path.localeCompare(b.path)).map((f) => cloneFile(f)),
      }),
    );
    await this.queue;
  }
}
