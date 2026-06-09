import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dashboard is a pure client of the Garage REST/WS API; no server-side
  // secrets live here. The API base is read at build time from NEXT_PUBLIC_GARAGE_URL.
  // Pin the file-tracing root to this app so the repo's root lockfile doesn't
  // confuse Next's workspace inference.
  outputFileTracingRoot: here,
};

export default nextConfig;
