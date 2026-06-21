import { NextRequest, NextResponse } from "next/server";
import { ensureValidSession } from "@/lib/spotify";
import { freshMemory, getMemory, getPicks, nzDateKey, setMemory, setPicks } from "@/lib/store";
import { FeedbackRecord, FeedbackVerdict } from "@/lib/types";

export const dynamic = "force-dynamic";

// Saves the listener's podium for the day — the 1st/2nd/3rd ordering plus the
// reason they ranked it that way — and turns it into steering for future picks.
export async function POST(req: NextRequest) {
  const session = await ensureValidSession();
  if (!session) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  let body: { key?: string; ranking?: string[]; note?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const dateKey = body.key || nzDateKey();
  const ranking = Array.isArray(body.ranking) ? body.ranking : [];
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 600) : "";

  const picks = await getPicks(session.userId, dateKey);
  if (!picks) {
    return NextResponse.json({ error: "no_picks" }, { status: 404 });
  }

  picks.ranking = ranking;
  picks.rankNote = note || undefined;
  await setPicks(session.userId, picks);

  // Translate the podium into feedback. The #1 pick is a strong positive
  // signal; the free-text reason is attached to each pick (with its rank) since
  // that's the most specific instruction the curator gets.
  const mem = (await getMemory(session.userId)) ?? freshMemory(session.displayName || "Listener");
  const at = new Date().toISOString();
  const byId = new Map(picks.recommendations.map((r) => [r.id, r]));
  const records: FeedbackRecord[] = ranking
    .map((id, idx) => {
      const rec = byId.get(id);
      if (!rec) return null;
      const position = idx + 1;
      const verdict: FeedbackVerdict | undefined = position === 1 ? "loved" : undefined;
      const reason = note ? ` Their reason for the order: "${note}".` : "";
      return {
        recommendationId: rec.id,
        title: rec.title,
        artist: rec.artist,
        verdict,
        note: `Ranked #${position} of ${ranking.length} today.${reason}`,
        at
      } as FeedbackRecord;
    })
    .filter((r): r is FeedbackRecord => r !== null);

  const rankedIds = new Set(ranking);
  mem.feedback = [...mem.feedback.filter((f) => !rankedIds.has(f.recommendationId)), ...records].slice(-24);
  await setMemory(session.userId, mem);

  return NextResponse.json({ ok: true });
}
