import { getSupabaseAuthClient } from "@/server/auth/supabase";
import { authAction } from "@/server/http/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return authAction(request, getSupabaseAuthClient, "login");
}
