import "server-only";
import { getAuth } from "@/server/auth/better-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return getAuth().handler(request);
}
export function POST(request: Request) {
  return getAuth().handler(request);
}
