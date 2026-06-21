import { NextRequest, NextResponse } from "next/server";
import { ensureValidSession } from "@/lib/spotify";
import { createRecommendation, SessionMemory } from "@/lib/recommend";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await ensureValidSession();
  if (!session) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  // Session memory lives in the browser and rides along with each request —
  // nothing is persisted server-side.
  let memory: SessionMemory = {};
  try {
    const body = (await req.json()) as SessionMemory;
    memory = {
      history: Array.isArray(body.history) ? body.history.slice(-14) : [],
      // Bound the free-text note before it reaches the prompt.
      feedback: Array.isArray(body.feedback)
        ? body.feedback.slice(-8).map((f) => ({
            ...f,
            note: typeof f.note === "string" ? f.note.trim().slice(0, 600) || undefined : undefined
          }))
        : []
    };
  } catch {
    // No body / unparseable → treat as a fresh start.
  }

  try {
    const rec = await createRecommendation(session, memory);
    return NextResponse.json({ recommendation: rec });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "recommend_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
