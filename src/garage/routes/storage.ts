/**
 * Garage-global remote-storage settings (R2 / S3-compatible uploads mirror).
 * Admin-gated upstream (see `isAdminRoute`). The bucket secret is write-only:
 * accepted on PUT, reported only as `has_secret`.
 */

import type { StorageConfigStore } from "../storage/config-store.ts";
import type { UpdateStorageConfigInput } from "../contract.ts";
import { json, errorJson, readJson } from "../respond.ts";

export interface StorageRoutes {
  get(): Response;
  update(req: Request): Promise<Response>;
}

export function storageRoutes(store: StorageConfigStore): StorageRoutes {
  return {
    get(): Response {
      return json({ storage: store.dto() });
    },

    async update(req): Promise<Response> {
      let body: UpdateStorageConfigInput;
      try {
        body = await readJson<UpdateStorageConfigInput>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      store.update({
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.endpoint !== undefined ? { endpoint: body.endpoint ?? "" } : {}),
        ...(body.bucket !== undefined ? { bucket: body.bucket ?? "" } : {}),
        ...(body.prefix !== undefined ? { prefix: body.prefix ?? "" } : {}),
        ...(body.access_key_id !== undefined ? { accessKeyId: body.access_key_id ?? "" } : {}),
        ...(body.secret_access_key !== undefined ? { secretAccessKey: body.secret_access_key ?? "" } : {}),
      });
      if (store.get().enabled && !store.usable()) {
        return errorJson("bad_request", "Storage is enabled but endpoint, bucket, access key, or secret is missing", 400);
      }
      return json({ storage: store.dto() });
    },
  };
}
