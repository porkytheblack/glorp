/**
 * Admin authentication for the Garage dashboard. A single admin identity is
 * provisioned via env vars; a successful login mints a short-lived HS256 JWT
 * the dashboard then presents like an API key. The JWT carries the `admin`
 * scope, so it authorizes every Garage route (see `adminKeyFromToken`).
 *
 *   GARAGE_ADMIN_USER       admin username (login disabled if unset)
 *   GARAGE_ADMIN_PASSWORD   admin password (login disabled if unset)
 *   GARAGE_JWT_SECRET       signing secret (defaults to one derived from the
 *                           password, so a username + password is enough)
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { sign, verify } from "hono/jwt";
import type { ApiKey } from "./types.ts";

/** Token lifetime — 12 hours. The dashboard re-logs-in when it expires. */
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

export interface AdminTokenPayload {
  sub: string;
  role: "admin";
  iat: number;
  exp: number;
}

/** Whether an admin identity has been provisioned (both user and password). */
export function adminAuthConfigured(): boolean {
  return Boolean(process.env.GARAGE_ADMIN_USER && process.env.GARAGE_ADMIN_PASSWORD);
}

/** The signing secret: explicit `GARAGE_JWT_SECRET`, else derived from the password. */
function jwtSecret(): string {
  const explicit = process.env.GARAGE_JWT_SECRET;
  if (explicit) return explicit;
  return createHash("sha256").update(`garage-jwt:${process.env.GARAGE_ADMIN_PASSWORD ?? ""}`).digest("hex");
}

/** Constant-time string compare via fixed-width sha256 digests. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Validate a username/password pair against the provisioned admin identity. */
export function verifyAdminCredentials(username: string, password: string): boolean {
  if (!adminAuthConfigured()) return false;
  const okUser = safeEqual(username, process.env.GARAGE_ADMIN_USER!);
  const okPass = safeEqual(password, process.env.GARAGE_ADMIN_PASSWORD!);
  return okUser && okPass;
}

export interface MintedToken {
  token: string;
  expiresAt: string;
  user: string;
}

/** Sign a fresh admin JWT for `username`. */
export async function signAdminToken(username: string): Promise<MintedToken> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const payload: AdminTokenPayload = { sub: username, role: "admin", iat, exp };
  const token = await sign({ ...payload }, jwtSecret(), "HS256");
  return { token, expiresAt: new Date(exp * 1000).toISOString(), user: username };
}

/** Verify an admin JWT, returning its payload or null (expired/invalid/forged). */
export async function verifyAdminToken(token: string): Promise<AdminTokenPayload | null> {
  if (!adminAuthConfigured()) return null;
  try {
    const payload = (await verify(token, jwtSecret(), "HS256")) as unknown as AdminTokenPayload;
    return payload.role === "admin" ? payload : null;
  } catch {
    return null;
  }
}

/** A synthetic `admin`-scoped ApiKey representing a logged-in dashboard admin. */
export function adminKeyFromToken(payload: AdminTokenPayload): ApiKey {
  return {
    id: "admin-jwt",
    name: payload.sub,
    keyHash: "",
    keyPrefix: "jwt",
    scopes: ["admin"],
    createdAt: new Date(payload.iat * 1000).toISOString(),
    lastUsed: null,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    revoked: false,
    namespace: null,
  };
}
