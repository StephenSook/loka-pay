import { handleAudio } from "@/lib/call-server";

// GET /api/call/audio?p&m (PLAN.md 3.9): the voice Vonage plays, made by ElevenLabs from a
// signed audio link. Everything is in lib/call-server.ts; this file only binds the route.

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleAudio(request);
}
