import { handleCall } from "@/lib/call-server";

// POST /api/call (PLAN.md 3.9): places one phone call that reads a settled devnet payment.
// Everything is in lib/call-server.ts; this file only binds the route.

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleCall(request);
}
