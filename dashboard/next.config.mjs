/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dashboard is a pure client of the Garage REST/WS API; no server-side
  // secrets live here. The API base is read at runtime from NEXT_PUBLIC_GARAGE_URL.
};

export default nextConfig;
