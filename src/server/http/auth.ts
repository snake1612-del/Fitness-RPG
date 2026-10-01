type AuthClient = {
  auth: {
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<{ error: unknown }>;
    signOut(options: { scope: "local" }): Promise<{ error: unknown }>;
  };
};
const headers = { "Cache-Control": "no-store" };

export async function authAction(
  request: Request,
  getClient: () => Promise<AuthClient>,
  action: "login" | "logout",
): Promise<Response> {
  // Credential and logout actions must originate from this browser origin.
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "forbidden" }, { status: 403, headers });
  try {
    let credentials: { email: string; password: string } | undefined;
    if (action === "login") {
      const body = await request.json().catch(() => null);
      if (
        !body ||
        typeof body !== "object" ||
        typeof body.email !== "string" ||
        !body.email.trim() ||
        typeof body.password !== "string" ||
        !body.password ||
        body.email.length > 320 ||
        body.password.length > 4096 ||
        Object.keys(body).some((key) => !["email", "password"].includes(key))
      )
        return Response.json(
          { error: "invalid_input" },
          { status: 400, headers },
        );
      credentials = { email: body.email.trim(), password: body.password };
    }
    const client = await getClient();
    const { error } =
      action === "login"
        ? await client.auth.signInWithPassword(credentials!)
        : await client.auth.signOut({ scope: "local" });
    if (error) {
      const authError = error as { status?: number; name?: string };
      const unavailable =
        action === "logout" ||
        authError.name === "AuthRetryableFetchError" ||
        (typeof authError.status === "number" && authError.status >= 429);
      return Response.json(
        {
          error: unavailable ? "service_unavailable" : "invalid_credentials",
        },
        { status: unavailable ? 503 : 401, headers },
      );
    }
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json(
      { error: "service_unavailable" },
      { status: 503, headers },
    );
  }
}
