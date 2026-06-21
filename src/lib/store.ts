import { getCloudflareContext } from "@opennextjs/cloudflare";
import { FeedbackRecord, Recommendation, TasteProfile } from "./types";

// Everything Cue persists server-side. Deliberately credential-free: we store a
// snapshot of taste + what's been shown + how the listener reacted, never the
// Spotify login itself. This is what lets the midnight cron generate picks while
// the listener is away.
export interface UserMemory {
  displayName: string;
  taste: TasteProfile | null;
  tasteUpdatedAt: number; // epoch ms; 0 when never built
  history: { title: string; artist: string }[]; // permanent exclusion set
  feedback: FeedbackRecord[];
}

export interface DailyPicks {
  key: string; // NZ date key, e.g. "2026-06-21"
  recommendations: Recommendation[];
  ranking?: string[]; // recommendation ids, 1st → 3rd
  rankNote?: string; // the listener's reason for the ordering
  generatedAt: string; // ISO
}

function kv(): KVNamespace {
  return getCloudflareContext().env.CUE_KV;
}

const memKey = (userId: string) => `mem:${userId}`;
const picksKey = (userId: string, dateKey: string) => `picks:${userId}:${dateKey}`;

export function freshMemory(displayName: string): UserMemory {
  return { displayName, taste: null, tasteUpdatedAt: 0, history: [], feedback: [] };
}

export async function getMemory(userId: string): Promise<UserMemory | null> {
  return (await kv().get(memKey(userId), "json")) as UserMemory | null;
}

export async function setMemory(userId: string, mem: UserMemory): Promise<void> {
  await kv().put(memKey(userId), JSON.stringify(mem));
}

export async function getPicks(userId: string, dateKey: string): Promise<DailyPicks | null> {
  return (await kv().get(picksKey(userId, dateKey), "json")) as DailyPicks | null;
}

export async function setPicks(userId: string, picks: DailyPicks): Promise<void> {
  // Keep a few days of picks around, then let them fall away.
  await kv().put(picksKey(userId, picks.key), JSON.stringify(picks), {
    expirationTtl: 60 * 60 * 24 * 14
  });
}

// Every known listener — the cron walks these to pre-generate each morning.
export async function listUserIds(): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv().list({ prefix: "mem:", cursor });
    for (const k of page.keys) ids.push(k.name.slice("mem:".length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return ids;
}

// Appends today's picks to the permanent exclusion set (deduped, never
// truncated) so a song shown once never comes back.
export function appendHistory(
  history: { title: string; artist: string }[],
  picks: { title: string; artist: string }[]
): { title: string; artist: string }[] {
  const merged = [...history, ...picks.map(({ title, artist }) => ({ title, artist }))];
  const seen = new Set<string>();
  return merged.filter(({ title, artist }) => {
    const fingerprint = `${title}|${artist}`.toLowerCase();
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

// The day boundary is NZ midnight — the same instant the cron fires — so the
// key the page asks for always matches the key the cron wrote.
export function nzDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
