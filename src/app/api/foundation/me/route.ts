import { getSupabaseIdentityProvider } from "@/server/auth/supabase";
import { getDatabaseReadinessGateway } from "@/server/db/runtime";
import { identityResponse } from "@/server/http/foundation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return identityResponse(
    getSupabaseIdentityProvider,
    getDatabaseReadinessGateway,
  );
}
