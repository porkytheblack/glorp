/**
 * Thin helpers around `Bun.S3Client` for the uploads mirror: building a client
 * from the stored config, computing tenant-scoped bucket keys, walking the
 * local upload tree, and paging a remote prefix listing.
 *
 * Bun's S3Client speaks path-style to the configured endpoint (verified
 * empirically: PUT/GET/DELETE hit `/<bucket>/<key>`, list hits
 * `/<bucket>/?list-type=2&prefix=…`), so it works against R2 and any
 * S3-compatible stub without extra configuration.
 */

import { S3Client, type S3ListObjectsResponse } from "bun";
import * as fs from "node:fs";
import * as path from "node:path";
import type { StorageConfig } from "./types.ts";

/** One remote object: its full key and (when listed) its size in bytes. */
export interface RemoteObject {
  key: string;
  size: number;
}

/** Build an S3 client from a usable config (caller guarantees fields present). */
export function clientFor(config: StorageConfig): S3Client {
  return new S3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    endpoint: config.endpoint,
  });
}

/** The bucket key prefix a session's files live under: `[prefix/]<ns>/<session>/`. */
export function keyPrefix(config: StorageConfig, nsId: string, sessionId: string): string {
  const segments = [config.prefix, nsId, sessionId].filter((s): s is string => Boolean(s));
  return `${segments.join("/")}/`;
}

/** Full bucket key for one relative path under a session. */
export function keyFor(config: StorageConfig, nsId: string, sessionId: string, rel: string): string {
  return keyPrefix(config, nsId, sessionId) + rel;
}

/** Relative POSIX paths of every file under `root` (recursing into subdirs). */
export function walkLocal(root: string): string[] {
  const out: string[] = [];
  const recurse = (dir: string): void => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) recurse(abs);
      else out.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  recurse(root);
  return out;
}

/** List every object under `prefix`, following continuation tokens. */
export async function listRemote(client: S3Client, prefix: string): Promise<RemoteObject[]> {
  const out: RemoteObject[] = [];
  let token: string | undefined;
  do {
    const page: S3ListObjectsResponse = await client.list({ prefix, continuationToken: token, maxKeys: 1000 });
    for (const obj of page.contents ?? []) {
      out.push({ key: obj.key, size: obj.size ?? 0 });
    }
    token = page.isTruncated ? page.nextContinuationToken ?? undefined : undefined;
  } while (token);
  return out;
}
