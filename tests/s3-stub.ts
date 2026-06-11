/**
 * A minimal in-process S3 stub for the uploads-mirror tests. Bun.S3Client speaks
 * path-style to a custom endpoint (verified empirically): PUT/GET/DELETE/HEAD hit
 * `/<bucket>/<key>` and list hits `/<bucket>/?list-type=2&prefix=…`. Auth
 * signatures are ignored. `failAll` flips every object op (not list) to 500 to
 * exercise the engine's error path.
 */

import * as http from "node:http";

export interface S3Stub {
  endpoint: string;
  objects: Map<string, Buffer>;
  /** When true, every object PUT/GET/DELETE/HEAD returns 500. */
  failAll: boolean;
  requests: string[];
  close(): Promise<void>;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function listXml(objects: Map<string, Buffer>, prefix: string): string {
  let body = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bucket</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>0</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>`;
  for (const [key, buf] of objects) {
    if (!key.startsWith(prefix)) continue;
    body += `<Contents><Key>${xmlEscape(key)}</Key><Size>${buf.length}</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>&quot;etag&quot;</ETag><StorageClass>STANDARD</StorageClass></Contents>`;
  }
  return body + "</ListBucketResult>";
}

/** Read a request body into a Buffer. */
function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function startS3Stub(bucket = "bucket"): Promise<S3Stub> {
  const objects = new Map<string, Buffer>();
  const requests: string[] = [];
  const state = { failAll: false };

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://stub");
      requests.push(`${req.method} ${url.pathname}${url.search}`);
      // ListObjectsV2 — never gated by failAll (the engine lists to pull).
      if (url.searchParams.get("list-type") === "2") {
        const body = listXml(objects, url.searchParams.get("prefix") ?? "");
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(body);
        return;
      }
      const key = decodeURIComponent(url.pathname.replace(new RegExp(`^/${bucket}/`), ""));
      if (state.failAll) {
        res.writeHead(500, { "content-type": "application/xml" });
        res.end(`<Error><Code>InternalError</Code><Message>stub failure</Message></Error>`);
        return;
      }
      if (req.method === "PUT") {
        objects.set(key, await readBody(req));
        res.writeHead(200, { ETag: '"etag"' });
        res.end();
        return;
      }
      if (req.method === "HEAD") {
        const v = objects.get(key);
        if (!v) return void res.writeHead(404).end();
        res.writeHead(200, { "content-length": String(v.length) });
        res.end();
        return;
      }
      if (req.method === "GET") {
        const v = objects.get(key);
        if (!v) return void res.writeHead(404).end("missing");
        res.writeHead(200, { "content-length": String(v.length) });
        res.end(v);
        return;
      }
      if (req.method === "DELETE") {
        objects.delete(key);
        res.writeHead(204).end();
        return;
      }
      res.writeHead(400).end();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    objects,
    get failAll() {
      return state.failAll;
    },
    set failAll(v: boolean) {
      state.failAll = v;
    },
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
