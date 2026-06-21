import { NextRequest, NextResponse } from "next/server";
import { ensureValidSession, saveTrackToLibrary } from "@/lib/spotify";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await ensureValidSession();
  if (!session) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  let body: { trackUri?: string; trackId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const uri = body.trackUri || (body.trackId ? `spotify:track:${body.trackId}` : null);
  if (!uri) {
    return NextResponse.json({ error: "missing_track" }, { status: 400 });
  }
  try {
    await saveTrackToLibrary(session.accessToken, uri);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "save_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
