import { buildResourcesCuratorTools } from "glove-memory";
import type { ResourceFsAdapter } from "glove-memory";
import type { GloveFoldArgs } from "glove-core/glove";
import { FileResourcesAdapter } from "../resources/file-adapter.ts";
import { createGlorpMemorySchema } from "../resources/schema.ts";
import { withResultClamp } from "../tools/result-clamp.ts";

type FoldTarget<T> = T & { fold<I>(args: unknown): T };

export function createSessionResources(dataDir: string, sessionId: string, filePath?: string): ResourceFsAdapter {
  return new FileResourcesAdapter({
    dataDir,
    sessionId,
    schema: createGlorpMemorySchema(),
    ...(filePath ? { filePath } : {}),
  });
}

export function foldResourceTools<T>(glove: FoldTarget<T>, resources: ResourceFsAdapter): FoldTarget<T> {
  for (const tool of buildResourcesCuratorTools(resources) as unknown[]) {
    glove.fold(withResultClamp(tool as GloveFoldArgs<unknown>));
  }
  return glove;
}
