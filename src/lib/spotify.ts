import { getSession, setSession, Session } from "./session";
import { SpotifyArtistLite, SpotifyTrackLite, SpotifyTrackMatch } from "./types";

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

export const SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-top-read",
  "user-library-read",
  "user-library-modify",
  "user-read-recently-played",
  "playlist-read-private",
  "playlist-modify-private",
  // In-browser playback via the Web Playback SDK (Premium accounts only).
  "streaming"
].join(" ");

function clientId(): string {
  const v = process.env.SPOTIFY_CLIENT_ID;
  if (!v) throw new Error("SPOTIFY_CLIENT_ID is not set");
  return v;
}
function clientSecret(): string {
  const v = process.env.SPOTIFY_CLIENT_SECRET;
  if (!v) throw new Error("SPOTIFY_CLIENT_SECRET is not set");
  return v;
}
function redirectUri(): string {
  const v = process.env.SPOTIFY_REDIRECT_URI;
  if (!v) throw new Error("SPOTIFY_REDIRECT_URI is not set");
  return v;
}
function basicAuth(): string {
  return Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64");
}

export function getAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    scope: SCOPES,
    redirect_uri: redirectUri(),
    state,
    // Force the consent screen so newly-added scopes (e.g. library-modify)
    // are actually granted rather than silently reusing a narrower prior grant.
    show_dialog: "true"
  });
  return `${ACCOUNTS}/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri()
    }),
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error(`Spotify token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

// App-level token via the client-credentials flow. It can't read a user's
// library, but it CAN search the catalogue — enough to ground a recommendation
// against a real track when no user is present (e.g. the midnight cron).
let appToken: { token: string; expiresAt: number } | null = null;
export async function getAppToken(): Promise<string> {
  if (appToken && Date.now() < appToken.expiresAt - 60_000) return appToken.token;
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error(`Spotify app token failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  appToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return appToken.token;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }),
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error(`Spotify token refresh failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

// Returns a valid session, refreshing the access token if it is near expiry.
// Persists any refreshed token back to the cookie.
export async function ensureValidSession(): Promise<Session | null> {
  const session = await getSession();
  if (!session) return null;

  const skew = 60_000; // refresh if within 60s of expiry
  if (Date.now() < session.expiresAt - skew) return session;

  const refreshed = await refreshAccessToken(session.refreshToken);
  const updated: Session = {
    ...session,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000
  };
  await setSession(updated);
  return updated;
}

async function api<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error(`Spotify API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export interface SpotifyProfile {
  id: string;
  display_name: string | null;
  email?: string;
  product?: string; // "premium" | "free" | "open" — gates in-browser playback
}

export async function getProfile(token: string): Promise<SpotifyProfile> {
  return api<SpotifyProfile>(token, "/me");
}

export async function getTopArtists(
  token: string,
  timeRange: "short_term" | "medium_term" | "long_term",
  limit = 20
): Promise<SpotifyArtistLite[]> {
  const data = await api<{ items: { id: string; name: string; genres: string[] }[] }>(
    token,
    `/me/top/artists?time_range=${timeRange}&limit=${limit}`
  );
  return data.items.map((a) => ({ id: a.id, name: a.name, genres: a.genres ?? [] }));
}

export async function getTopTracks(
  token: string,
  timeRange: "short_term" | "medium_term" | "long_term",
  limit = 20
): Promise<SpotifyTrackLite[]> {
  const data = await api<{
    items: { id: string; name: string; artists: { name: string }[] }[];
  }>(token, `/me/top/tracks?time_range=${timeRange}&limit=${limit}`);
  return data.items.map((t) => ({
    id: t.id,
    name: t.name,
    artists: t.artists.map((x) => x.name)
  }));
}

export interface SavedTrack {
  name: string;
  artists: string[];
  addedAt: string;
  year: string;
}

export async function getSavedTracks(token: string, limit = 30): Promise<SavedTrack[]> {
  const data = await api<{
    items: {
      added_at: string;
      track: {
        name: string;
        artists: { name: string }[];
        album: { release_date: string };
      };
    }[];
  }>(token, `/me/tracks?limit=${limit}`);
  return data.items
    .filter((i) => i.track)
    .map((i) => ({
      name: i.track.name,
      artists: i.track.artists.map((a) => a.name),
      addedAt: i.added_at,
      year: (i.track.album?.release_date ?? "").slice(0, 4)
    }));
}

export async function getRecentlyPlayed(token: string, limit = 50): Promise<SpotifyTrackLite[]> {
  const data = await api<{
    items: { track: { id: string; name: string; artists: { name: string }[] } | null }[];
  }>(token, `/me/player/recently-played?limit=${limit}`);
  return data.items
    .filter((i) => i.track)
    .map((i) => ({
      id: i.track!.id,
      name: i.track!.name,
      artists: i.track!.artists.map((a) => a.name)
    }));
}

// Samples tracks from the playlists the user actually curates (owned or
// collaborative), so a listener's hand-built collections inform taste — not
// just Spotify's computed top lists. Followed/algorithmic playlists are skipped.
export async function getCuratedPlaylistTracks(
  token: string,
  opts: { maxPlaylists?: number; perPlaylist?: number } = {}
): Promise<SpotifyTrackLite[]> {
  const maxPlaylists = opts.maxPlaylists ?? 6;
  const perPlaylist = opts.perPlaylist ?? 12;

  const me = await getProfile(token);
  const lists = await api<{
    items: { id: string; owner: { id: string }; collaborative: boolean }[];
  }>(token, `/me/playlists?limit=50`);

  const mine = lists.items
    .filter((p) => p.owner?.id === me.id || p.collaborative)
    .slice(0, maxPlaylists);

  const results = await Promise.all(
    mine.map((p) =>
      api<{ items: { track: { id: string; name: string; artists: { name: string }[] } | null }[] }>(
        token,
        `/playlists/${p.id}/tracks?limit=${perPlaylist}&fields=items(track(id,name,artists(name)))`
      )
        .then((d) =>
          d.items
            .filter((i) => i.track)
            .map((i) => ({
              id: i.track!.id,
              name: i.track!.name,
              artists: i.track!.artists.map((a) => a.name)
            }))
        )
        .catch(() => [] as SpotifyTrackLite[])
    )
  );

  return results.flat();
}

interface SearchTrackRaw {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  preview_url: string | null;
  external_urls: { spotify: string };
  artists: { name: string }[];
  album: { name: string; release_date: string; images: { url: string }[] };
}

function toMatch(t: SearchTrackRaw): SpotifyTrackMatch {
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artist: t.artists.map((a) => a.name).join(", "),
    album: t.album?.name ?? "",
    year: (t.album?.release_date ?? "").slice(0, 4),
    durationMs: t.duration_ms,
    albumImage: t.album?.images?.[0]?.url ?? null,
    spotifyUrl: t.external_urls?.spotify ?? "",
    previewUrl: t.preview_url ?? null
  };
}

// Normalizes a title/artist string for comparison: lowercase, strip accents,
// drop parentheticals and "feat." tails, collapse to alphanumeric words.
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(feat|ft|featuring|with)\b.*$/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function artistMatches(want: string, got: string[]): boolean {
  const w = norm(want);
  if (!w) return false;
  return got.some((a) => {
    const g = norm(a);
    return !!g && (g === w || g.includes(w) || w.includes(g));
  });
}

function titleMatches(want: string, got: string): boolean {
  const w = norm(want);
  const g = norm(got);
  if (!w || !g) return false;
  if (g === w || g.includes(w) || w.includes(g)) return true;
  // Fall back to meaningful-token overlap for minor wording differences.
  const ws = w.split(" ").filter((x) => x.length > 2);
  const gs = new Set(g.split(" ").filter((x) => x.length > 2));
  if (ws.length === 0) return false;
  const hits = ws.filter((x) => gs.has(x)).length;
  return hits / ws.length >= 0.6;
}

// Scores an accepted candidate so we can prefer the cleanest match.
function score(t: SearchTrackRaw, title: string, artist: string): number {
  let s = 0;
  if (norm(t.name) === norm(title)) s += 2;
  if (t.artists.some((a) => norm(a.name) === norm(artist))) s += 2;
  if (t.album?.images?.[0]?.url) s += 1;
  return s;
}

// Grounds a recommendation by finding the REAL track on Spotify. It only
// accepts a result whose artist AND title genuinely match what was proposed —
// if nothing matches, it returns null rather than guessing a wrong track.
export async function findTrack(
  token: string,
  opts: { title: string; artist: string; rawQuery?: string }
): Promise<SpotifyTrackMatch | null> {
  const queries = [
    `track:${opts.title} artist:${opts.artist}`,
    `artist:${opts.artist} ${opts.title}`,
    `${opts.title} ${opts.artist}`,
    opts.rawQuery && opts.rawQuery.trim().length > 0 ? opts.rawQuery : ""
  ].filter(Boolean);

  const accepted: SearchTrackRaw[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    const data = await api<{ tracks: { items: SearchTrackRaw[] } }>(
      token,
      `/search?type=track&limit=8&q=${encodeURIComponent(q)}`
    );
    for (const t of data.tracks?.items ?? []) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      if (
        artistMatches(
          opts.artist,
          t.artists.map((a) => a.name)
        ) &&
        titleMatches(opts.title, t.name)
      ) {
        accepted.push(t);
      }
    }
  }

  if (accepted.length === 0) return null;
  accepted.sort((a, b) => score(b, opts.title, opts.artist) - score(a, opts.title, opts.artist));
  return toMatch(accepted[0]);
}

// Saves a track to the user's library. Spotify's recent platform changes
// retired the legacy PUT /me/tracks endpoint (now returns 403) in favour of
// the unified PUT /me/library, which takes Spotify URIs as a query parameter.
export async function saveTrackToLibrary(token: string, trackUri: string): Promise<void> {
  const res = await fetch(`${API}/me/library?uris=${encodeURIComponent(trackUri)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error(`Spotify save failed: ${res.status} ${await res.text()}`);
  }
}
