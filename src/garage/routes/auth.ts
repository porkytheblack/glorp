/**
 * Admin auth routes for the dashboard: `POST /auth/login` exchanges the
 * env-provisioned username/password for a short-lived JWT, and `GET /auth/me`
 * echoes the authenticated identity. Login is open (it issues the credential);
 * `me` runs after the auth gate.
 */

import { json, errorJson, readJson } from "../respond.ts";
import {
  adminAuthConfigured,
  verifyAdminCredentials,
  signAdminToken,
} from "../auth/admin.ts";
import type { ApiKey } from "../auth/types.ts";

interface LoginBody {
  username?: string;
  password?: string;
}

export function authRoutes() {
  return {
    /** Whether admin login is available at all (creds provisioned). */
    status(): Response {
      return json({ admin_login: adminAuthConfigured() });
    },

    async login(req: Request): Promise<Response> {
      if (!adminAuthConfigured()) {
        return errorJson(
          "login_disabled",
          "Admin login is not configured. Set GARAGE_ADMIN_USER and GARAGE_ADMIN_PASSWORD.",
          501,
        );
      }
      let body: LoginBody;
      try {
        body = await readJson<LoginBody>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      const { username, password } = body;
      if (!username || !password) {
        return errorJson("bad_request", "username and password are required", 400);
      }
      if (!verifyAdminCredentials(username, password)) {
        return errorJson("unauthorized", "Invalid username or password", 401);
      }
      return json(await signAdminToken(username));
    },

    /** Echo the authenticated identity (the resolved key from requireAuth). */
    me(key: ApiKey | null): Response {
      if (!key) return json({ authenticated: false });
      return json({
        authenticated: true,
        user: key.name,
        scopes: key.scopes,
        namespace: key.namespace ?? null,
        is_admin: key.scopes.includes("admin"),
      });
    },
  };
}

export type AuthRoutes = ReturnType<typeof authRoutes>;
