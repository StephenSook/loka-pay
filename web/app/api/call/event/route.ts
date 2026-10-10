import { handleEvent } from "@/lib/call-server";

// POST /api/call/event (PLAN.md 3.9): Vonage reports each call's progress here. The body is
// never read, stored or logged; the answer is 204.

export const runtime = "nodejs";

export function POST(): Response {
  return handleEvent();
}
