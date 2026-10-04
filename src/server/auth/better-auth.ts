import "server-only";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { getServerConfig } from "../config/server";
import { getDatabase } from "../db/runtime";
import { createAuth } from "./options";
import { createIdentityProvider } from "./identity";
let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (auth ??= createAuth(getDatabase(), getServerConfig(), [
    nextCookies(),
  ]));
}
export async function getIdentityProvider() {
  const requestHeaders = await headers();
  return createIdentityProvider(() =>
    getAuth().api.getSession({
      headers: requestHeaders,
      query: { disableCookieCache: true },
    }),
  );
}
