import { NextRequest, NextResponse } from "next/server";
import { ensureValidSession } from "@/lib/spotify";
import { buildTasteProfile } from "@/lib/taste";
import { createDailyPicks } from "@/lib/recommend";
import {
  appendHistory,
  DailyPicks,
  freshMemory,
  getMemory,
  getPicks,
  nzDateKey,
  setMemory,
  setPicks,
  UserMemory
} from "@/lib/store";
import { FeedbackRecord } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PICK_COUNT = 3;
const TASTE_TTL = 1000 * 60 * 60 * 20; // rebuild the taste snapshot once a day-ish

// Returns today's three picks for the signed-in listener. If the midnight cron
// already wrote them they come straight from KV; otherwise we generate them now
// and cache them so the rest of the day is instant. Either way the taste
// snapshot is refreshed when stale so the cron has fresh data to work from.
export async function POST(req: NextRequest) {
  const session = await ensureValidSession();
  if (!session) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const userId = session.userId;
  const displayName = session.displayName || "Listener";
  const dateKey = nzDateKey();

  let mem: UserMemory = (await getMemory(userId)) ?? freshMemory(displayName);
  mem.displayName = displayName;

  // One-time migration: seed server memory from what the browser was holding.
  try {
    const body = (await req.json()) as { seedHistory?: unknown; seedFeedback?: unknown };
    if (mem.history.length === 0 && Array.isArray(body.seedHistory)) {
      mem.history = appendHistory([], body.seedHistory as { title: string; artist: string }[]);
    }
    if (mem.feedback.length === 0 && Array.isArray(body.seedFeedback)) {
      mem.feedback = (body.seedFeedback as FeedbackRecord[]).slice(-24);
    }
  } catch {
    // No body — nothing to seed.
  }

  // Keep the taste snapshot fresh so the cron always has current data.
  let memDirty = false;
  if (!mem.taste || Date.now() - mem.tasteUpdatedAt > TASTE_TTL) {
    mem.taste = await buildTasteProfile(session.accessToken, displayName);
    mem.tasteUpdatedAt = Date.now();
    memDirty = true;
  }

  let picks = await getPicks(userId, dateKey);
  if (!picks || picks.recommendations.length === 0) {
    const recommendations = await createDailyPicks({
      taste: mem.taste,
      history: mem.history,
      feedback: mem.feedback,
      groundingToken: session.accessToken,
      count: PICK_COUNT
    });
    mem.history = appendHistory(mem.history, recommendations);
    memDirty = true;
    picks = { key: dateKey, recommendations, generatedAt: new Date().toISOString() } as DailyPicks;
    await setPicks(userId, picks);
  }

  if (memDirty) await setMemory(userId, mem);

  return NextResponse.json({
    displayName,
    key: picks.key,
    recommendations: picks.recommendations,
    ranking: picks.ranking ?? null,
    rankNote: picks.rankNote ?? null
  });
}
