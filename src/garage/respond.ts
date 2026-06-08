/** Tiny JSON response helpers shared across Garage route handlers. */

export function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function errorJson(error: string, message: string, status: number): Response {
  return json({ error, message }, status);
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** Parse a JSON request body, returning `{}` for an empty body. */
export async function readJson<T>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}
