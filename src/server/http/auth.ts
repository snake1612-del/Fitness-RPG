import type { createAuth } from "../auth/options";
type Auth = Pick<ReturnType<typeof createAuth>, "handler">;
const headers = { "Cache-Control": "no-store" };
export async function authAction(
  request: Request,
  getAuth: () => Auth,
  action: "login" | "logout",
): Promise<Response> {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "forbidden" }, { status: 403, headers });
  try {
    let body: { email: string; password: string } | undefined;
    if (action === "login") {
      const input = await request.json().catch(() => null);
      if (
        !input ||
        typeof input !== "object" ||
        typeof input.email !== "string" ||
        !input.email.trim() ||
        typeof input.password !== "string" ||
        !input.password ||
        input.email.length > 320 ||
        input.password.length > 4096 ||
        Object.keys(input).some((key) => !["email", "password"].includes(key))
      )
        return Response.json(
          { error: "invalid_input" },
          { status: 400, headers },
        );
      body = { email: input.email.trim(), password: input.password };
    }
    const auth = getAuth();
    // Use the public HTTP handler so Better Auth origin checks and rate limiting
    // also run for these app-facing aliases.
    const url = new URL(request.url);
    url.pathname =
      action === "login" ? "/api/auth/sign-in/email" : "/api/auth/sign-out";
    const authHeaders = new Headers(request.headers);
    authHeaders.set("Content-Type", "application/json");
    const result = await auth.handler(
      new Request(url, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body ?? {}),
      }),
    );
    if (!result.ok) {
      const status =
        result.status === 403
          ? 403
          : action === "login" && [400, 401, 422].includes(result.status)
            ? 401
            : 503;
      return Response.json(
        {
          error:
            status === 403
              ? "forbidden"
              : status === 401
                ? "invalid_credentials"
                : "service_unavailable",
        },
        { status, headers },
      );
    }
    const response = Response.json({ ok: true }, { headers });
    for (const cookie of result.headers.getSetCookie())
      response.headers.append("Set-Cookie", cookie);
    return response;
  } catch {
    return Response.json(
      { error: "service_unavailable" },
      { status: 503, headers },
    );
  }
}
