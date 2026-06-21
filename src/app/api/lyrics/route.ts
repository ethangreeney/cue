import { NextRequest, NextResponse } from "next/server";
import { getCachedLyrics, setCachedLyrics } from "@/lib/store";

export const dynamic = "force-dynamic";

// We proxy lyrics through the server (rather than calling lrclib from the
// browser) to dodge CORS and to send a polite identifying User-Agent. lrclib is
// a free, community-run synced-lyrics database — coverage is good but partial,
// so "not found" is an expected, gracefully-handled outcome, not an error.
const LRCLIB = "https://lrclib.net/api";
const UA = "Cue/1.0 (https://github.com/ethangreeney/cue)";

interface LrclibTrack {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
  duration?: number;
}

interface SyncedLine {
  time: number; // seconds from start
  text: string;
}

// Parse an LRC blob into time-ordered lines. Handles multiple timestamps on one
// line (e.g. "[00:12.34][01:02.00] words") and drops metadata/empty lines.
function parseLrc(lrc: string): SyncedLine[] {
  const out: SyncedLine[] = [];
  const tag = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of lrc.split(/\r?\n/)) {
    const text = raw.replace(tag, "").trim();
    let m: RegExpExecArray | null;
    tag.lastIndex = 0;
    const stamps: number[] = [];
    while ((m = tag.exec(raw)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseInt(m[3].padEnd(3, "0").slice(0, 3), 10) / 1000 : 0;
      stamps.push(min * 60 + sec + frac);
    }
    for (const t of stamps) out.push({ time: t, text });
  }
  return out.sort((a, b) => a.time - b.time);
}

async function lrclibGet(params: URLSearchParams): Promise<LrclibTrack | null> {
  const res = await fetch(`${LRCLIB}/get?${params.toString()}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store"
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lrclib get ${res.status}`);
  return (await res.json()) as LrclibTrack;
}

async function lrclibSearch(track: string, artist: string): Promise<LrclibTrack | null> {
  const params = new URLSearchParams({ track_name: track, artist_name: artist });
  const res = await fetch(`${LRCLIB}/search?${params.toString()}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store"
  });
  if (!res.ok) return null;
  const list = (await res.json()) as LrclibTrack[];
  if (!Array.isArray(list) || list.length === 0) return null;
  // Prefer a result that actually carries synced lyrics.
  return list.find((t) => t.syncedLyrics) ?? list[0];
}

// Lyrics never change for a track, so the response is safe to cache hard — both
// at our KV layer (shared across listeners) and in the browser.
const CACHE_HEADERS = { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" };
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const title = (sp.get("title") || "").trim();
  const artist = (sp.get("artist") || "").trim();
  const album = (sp.get("album") || "").trim();
  const duration = (sp.get("duration") || "").trim(); // seconds

  if (!title || !artist) {
    return NextResponse.json({ error: "title and artist required" }, { status: 400 });
  }

  // Signature is the same inputs the client sends, normalized — so two listeners
  // opening the same pick share one cache entry.
  const sig = [title, artist, album, duration].map(norm).join("|");
  const cached = await getCachedLyrics(sig).catch(() => null);
  if (cached) return NextResponse.json(cached, { headers: CACHE_HEADERS });

  try {
    // Exact match first (most accurate, returns the best synced version)…
    const getParams = new URLSearchParams({ track_name: title, artist_name: artist });
    if (album) getParams.set("album_name", album);
    if (duration) getParams.set("duration", duration);

    let track = await lrclibGet(getParams).catch(() => null);
    // …then a looser search if the exact signature didn't resolve.
    if (!track || (!track.syncedLyrics && !track.plainLyrics)) {
      track = (await lrclibSearch(title, artist).catch(() => null)) ?? track;
    }

    const payload =
      !track || track.instrumental
        ? { synced: [], plain: null, instrumental: !!track?.instrumental }
        : {
            synced: track.syncedLyrics ? parseLrc(track.syncedLyrics) : [],
            plain: track.plainLyrics ?? null,
            instrumental: false
          };

    // A resolved lookup (hit OR a genuine "no lyrics") is cacheable. Only a
    // thrown upstream error skips the cache, so a blip isn't frozen in as "none".
    await setCachedLyrics(sig, payload).catch(() => {});
    return NextResponse.json(payload, { headers: CACHE_HEADERS });
  } catch {
    // Treat any upstream failure as "no lyrics" — never block the player on it.
    return NextResponse.json({ synced: [], plain: null, instrumental: false });
  }
}
