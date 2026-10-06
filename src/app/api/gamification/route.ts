import { getIdentityProvider } from "@/server/auth/better-auth";
import { getGamificationApplication } from "@/server/gamification/application";
import { gamificationResponse } from "@/server/http/gamification";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return gamificationResponse(getIdentityProvider, getGamificationApplication);
}
