import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAppToken } from "@/lib/spotify";
import { createDailyPicks } from "@/lib/recommend";
import { appendHistory, getMemory, getPicks, listUserIds, nzDateKey, setMemory, setPicks } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PICK_COUNT = 3;

// Pre-generates everyone's picks. Invoked by the worker's scheduled() handler at
// NZ midnight (see worker.ts). Protected by a shared secret. Grounding uses an
// app-level Spotify token since no listener is present. A listener with no taste
// snapshot yet is skipped — they'll generate on their next visit instead.
export async function POST(req: NextRequest) {
  const secret = (getCloudflareContext().env as unknown as { CRON_SECRET?: string }).CRON_SECRET;
  if (!secret || req.headers.get("x-cron-key") !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  const dateKey = nzDateKey();
  const userIds = await listUserIds();
  const appToken = await getAppToken();

  let generated = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const userId of userIds) {
    try {
      const mem = await getMemory(userId);
      if (!mem?.taste) {
        skipped++;
        continue;
      }
      if (await getPicks(userId, dateKey)) {
        skipped++;
        continue;
      }
      const recommendations = await createDailyPicks({
        taste: mem.taste,
        history: mem.history,
        feedback: mem.feedback,
        groundingToken: appToken,
        count: PICK_COUNT
      });
      mem.history = appendHistory(mem.history, recommendations);
      await setMemory(userId, mem);
      await setPicks(userId, { key: dateKey, recommendations, generatedAt: new Date().toISOString() });
      generated++;
    } catch (e) {
      failures.push(`${userId}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  return NextResponse.json({ dateKey, users: userIds.length, generated, skipped, failures });
}
