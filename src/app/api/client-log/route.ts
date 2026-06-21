import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Lightweight sink for client-side diagnostics — chiefly why in-page playback
// fell back for a given user. It lands in the Worker logs (Cloudflare
// observability / `wrangler tail`), so a tester's failure is visible to us
// directly. Best-effort and non-sensitive: the client never sends tokens here.
export async function POST(req: Request) {
  try {
    const text = await req.text();
    if (text.length > 2000) return NextResponse.json({ ok: true });
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* keep the raw string */
    }
    console.warn("[client-log]", JSON.stringify(data));
  } catch {
    /* never throw from a logging endpoint */
  }
  return NextResponse.json({ ok: true });
}
