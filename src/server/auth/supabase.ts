import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { AuthIdentityProvider } from "@/application/foundation/ports";
import { getServerConfig } from "../config/server";
import { createIdentityProvider } from "./identity";

export async function getSupabaseAuthClient() {
  const config = getServerConfig();
  const cookieStore = await cookies();
  const client = createServerClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    },
  );

  return client;
}

export async function getSupabaseIdentityProvider(): Promise<AuthIdentityProvider> {
  return createIdentityProvider((await getSupabaseAuthClient()).auth);
}
