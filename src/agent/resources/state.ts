import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { MemorySchema, ResourceFile } from "glove-memory";

export interface ResourceState {
  dirs: string[];
  files: ResourceFile[];
}

export interface ResourceTree {
  schema: MemorySchema;
  files: Map<string, ResourceFile>;
  dirs: Set<string>;
}

export async function readResourceState(filePath: string): Promise<ResourceState> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ResourceState>;
    return {
      dirs: Array.isArray(parsed.dirs) ? parsed.dirs : [],
      files: Array.isArray(parsed.files) ? parsed.files : [],
    };
  } catch (err: any) {
    if (err?.code === "ENOENT") return { dirs: [], files: [] };
    throw err;
  }
}

export async function writeResourceState(filePath: string, state: ResourceState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  await fs.rename(tmp, filePath);
}
