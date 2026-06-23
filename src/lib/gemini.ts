import { FeedbackRecord, Lane, RecommendationDraft, TasteProfile } from "./types";

// How each lane should feel. The set is ordered trust → step out → departure.
// Every lane is DISCOVERY — even "core" must be something new to this listener,
// never one of their established favorites.
const LANE_BRIEF: Record<Lane, string> = {
  core: 'lane "core" (VERY YOU): the closest possible match that is STILL a discovery — a song that sits dead-center in their world and makes them think "this gets me," but that they almost certainly have NOT heard yet. A deep cut, an overlooked track, or a close adjacent artist. Never one of their established favorites, and never the signature/most-famous song of an artist already in their rotation.',
  stretch:
    'lane "stretch" (A BIT FURTHER): takes the core of their taste and broadens it one honest step — a neighboring sound, scene, or era they probably don\'t know yet but whose DNA they\'ll recognize. Discovery, not a reach too far.',
  outer:
    'lane "outer" (LEFT FIELD): a genuine departure outside their usual lanes — a bolder swing that could surprise them. Still chosen with taste (a real bridge from something they like), but clearly the wildcard.'
};

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

function model(): string {
  return process.env.GEMINI_MODEL || "gemini-3.5-flash";
}
function apiKey(): string {
  const v = process.env.GEMINI_API_KEY;
  if (!v) throw new Error("GEMINI_API_KEY is not set");
  return v;
}

// Gemini structured-output schema for one recommendation.
const RECOMMENDATION_PROPERTIES = {
    title: { type: "STRING", description: "Exact song title." },
    artist: { type: "STRING", description: "Primary artist name." },
    album: { type: "STRING", description: "Album the song appears on." },
    year: { type: "STRING", description: "Release year, 4 digits." },
    genres: { type: "ARRAY", items: { type: "STRING" }, description: "2-3 genre tags." },
    thesis: {
      type: "STRING",
      description: "One vivid sentence: why this song, for this person, today."
    },
    story: {
      type: "STRING",
      description:
        "A single flowing write-up of 3-4 SHORT paragraphs, separated by a blank line. High signal-to-noise — every sentence earns its place; no filler. Weave together, WITHOUT headers or labels: why this fits THIS listener's specific taste (name real patterns in their artists/genres), what to actually listen for, and the essential context on the song, artist, and scene. Open by connecting to the listener. Do NOT restate the thesis verbatim. Calm, specific, editorial prose — no hype."
    },
    furtherExploration: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "3-5 adjacent artist names if this resonates."
    },
    spotifySearchQuery: {
      type: "STRING",
      description: "A clean search string to find the exact track on Spotify."
    }
};

const RECOMMENDATION_FIELDS = [
  "title",
  "artist",
  "album",
  "year",
  "genres",
  "thesis",
  "story",
  "furtherExploration",
  "spotifySearchQuery"
];

const RECOMMENDATION_ITEM = {
  type: "OBJECT",
  properties: RECOMMENDATION_PROPERTIES,
  required: RECOMMENDATION_FIELDS,
  propertyOrdering: RECOMMENDATION_FIELDS
};

// Single pick — used by the on-demand /api/recommend path.
const RESPONSE_SCHEMA = RECOMMENDATION_ITEM;

// Batch items carry a "lane" so each pick's place on the spectrum is intrinsic
// to the data, not just its array position — grounding can drop/reorder picks
// without scrambling which one is "Very you" vs "Left field".
const BATCH_ITEM = {
  type: "OBJECT",
  properties: {
    ...RECOMMENDATION_PROPERTIES,
    lane: {
      type: "STRING",
      enum: ["core", "stretch", "outer"],
      description: "Which spectrum lane this pick fills."
    }
  },
  required: [...RECOMMENDATION_FIELDS, "lane"],
  propertyOrdering: [...RECOMMENDATION_FIELDS, "lane"]
};

// A whole day's worth at once — one round-trip that returns several DISTINCT
// picks. Far cheaper and more diverse than firing N near-identical prompts in
// parallel (which collapse onto the same canonical songs).
const BATCH_SCHEMA = {
  type: "OBJECT",
  properties: {
    recommendations: { type: "ARRAY", items: BATCH_ITEM }
  },
  required: ["recommendations"]
};

function steeringFromFeedback(feedback: FeedbackRecord[]): string {
  if (!feedback.length) return "No feedback yet — make a confident, well-judged first pick.";
  const lines = feedback.slice(-8).map((f) => {
    const who = `"${f.title}" by ${f.artist}`;
    const parts: string[] = [];
    switch (f.verdict) {
      case "loved":
        parts.push(`They LOVED ${who}. Stay close to that spirit — an adjacent artist or a deeper cut with the same emotional texture.`);
        break;
      case "nailed":
        parts.push(`${who} nailed their taste. Keep that accuracy but push one honest step further into discovery.`);
        break;
      case "too_obvious":
        parts.push(`${who} was TOO OBVIOUS / already known. Go meaningfully more obscure; avoid canonical, charting, or famous choices.`);
        break;
      case "too_weird":
        parts.push(`${who} was TOO WEIRD / inaccessible. Pull back toward something more melodic and immediate while keeping the taste.`);
        break;
      case "boring":
        parts.push(`${who} was BORING. Take a sharper, more surprising swing — more energy, edge, or emotional stakes.`);
        break;
      case "not_for_me":
        parts.push(`${who} was NOT FOR THEM. Pivot to a different corner of their taste; do not repeat that lane.`);
        break;
    }
    if (f.note && f.note.trim()) {
      // Free-text is the strongest, most specific signal — honor it directly.
      parts.push(`On ${who}, the listener said in their own words: "${f.note.trim()}". Treat this as the most important instruction and act on it concretely.`);
    }
    return parts.join(" ");
  });
  return lines.filter(Boolean).join("\n");
}

function buildPrompt(
  taste: TasteProfile,
  history: { title: string; artist: string }[],
  feedback: FeedbackRecord[]
): string {
  const already = history
    .map((h) => `- ${h.title} — ${h.artist}`)
    .join("\n");

  const nonce = Math.random().toString(36).slice(2, 8);

  return `You are the music curator behind "Cue" — a service that picks ONE deeply chosen song for a listener and explains why it matters. You write like a sharp, literate liner-note essayist: specific, calm, never hype, never generic.

# THE LISTENER
The tracks and artists below are music this person ALREADY KNOWS. They are
EVIDENCE of taste — a map of what they love — NOT a menu to pick from. Read them
to understand the listener, then point somewhere new.
Name: ${taste.displayName}
Taste summary: ${taste.summary}
Top genres: ${taste.topGenres.join(", ") || "unknown"}
Top artists: ${taste.topArtists.join(", ") || "unknown"}
Top tracks: ${taste.topTracks.map((t) => `${t.name} (${t.artist})`).join("; ") || "unknown"}
Recently saved: ${taste.recentSaves.map((t) => `${t.name} (${t.artist})`).join("; ") || "unknown"}
Currently in rotation (recently played): ${taste.recentlyPlayed.map((t) => `${t.name} (${t.artist})`).join("; ") || "unknown"}
From their own playlists: ${taste.playlistPicks.map((t) => `${t.name} (${t.artist})`).join("; ") || "unknown"}

# THE MANDATE: DISCOVERY ONLY
Cue exists to show people songs they DON'T already know. A pick the listener has
already heard is a failure, no matter how well it fits. Therefore:
- NEVER recommend any song listed above (top tracks, saved, in rotation, playlists).
- NEVER recommend the obvious signature hit of an artist already in their top
  artists — if they love an artist, they've already heard that song.
- Favor deep cuts, overlooked tracks, and adjacent artists they likely haven't
  reached yet. The bar is: "they probably have NOT heard this, but the moment it
  plays they'll feel it was made for them."

# FEEDBACK ON PAST PICKS (most recent last) — let this steer this pick
${steeringFromFeedback(feedback)}

# ALREADY RECOMMENDED — never pick any of these again
${already || "(none yet)"}

# YOUR TASK
Choose exactly ONE real, existing song to recommend right now.

Rules:
- It MUST be a real song that is actually available to stream on Spotify right now. Use the exact artist and title as they appear on Spotify. Do not invent songs, and avoid tracks likely to be missing from Spotify (out-of-print, unofficial, region-locked, or obscure-label rarities that never made it to streaming).
- Choose something genuinely good and well-matched — not the most obvious mainstream hit, but not willfully obscure either, unless feedback tells you to adjust.
- It MUST be new to THIS listener: not in their top tracks, saves, rotation, or playlists above, and not the signature song of an artist they already play. Discovery is the whole point.
- The "story" must reference SPECIFIC things about this listener's taste (their actual artists/genres), not vague flattery.
- Do not invent biographical or factual claims you are unsure of. If unsure about a backstory detail, keep it general rather than fabricating specifics.
- No numeric scores. No "as an AI" language. No emoji. No exclamation-mark hype.
- Keep every field tight and editorial. Prose, not bullet points.
- Vary your choice; selection token ${nonce}.

Return ONLY the structured JSON object.`;
}

function buildBatchPrompt(
  taste: TasteProfile,
  history: { title: string; artist: string }[],
  feedback: FeedbackRecord[],
  lanes: Lane[]
): string {
  const single = buildPrompt(taste, history, feedback);
  // Reuse the whole single-pick brief (listener, feedback, exclusions, rules)
  // and just swap the task for "give me one pick per spectrum lane, in order".
  const laneSpec = lanes.map((l, i) => `${i + 1}. ${LANE_BRIEF[l]}`).join("\n");
  const task = `# YOUR TASK
Choose exactly ${lanes.length} real, existing songs — ONE for each lane below, IN THIS ORDER. The lanes are increasing distances from this listener's established taste:

${laneSpec}

This is a deliberate spectrum, not a grab-bag: "core" must feel unmistakably like them, and "outer" must be a real departure — the gap between them should be obvious.
- Set each pick's "lane" field to its lane id ("core" | "stretch" | "outer").
- Every pick a DIFFERENT artist. Never the same artist twice.
- None of them may appear in the ALREADY RECOMMENDED list above.`;

  const body = single.slice(0, single.indexOf("# YOUR TASK")) + task;
  return `${body}

Rules:
- Each MUST be a real song actually streamable on Spotify right now. Use the exact artist and title as they appear on Spotify. Do not invent songs, and avoid tracks likely to be missing from Spotify (out-of-print, unofficial, region-locked, obscure-label rarities).
- Genuinely good, well-matched picks for their lane — not the most obvious mainstream hits, but not willfully obscure either, unless feedback says otherwise.
- Every pick MUST be new to THIS listener: none from their top tracks, saves, rotation, or playlists above, and never the signature song of an artist they already play. Even "core" is a discovery. This is the whole point.
- Each "story" must reference SPECIFIC things about this listener's taste, not vague flattery.
- Do not invent biographical or factual claims you are unsure of.
- No numeric scores. No "as an AI" language. No emoji. No exclamation-mark hype.
- Keep every field tight and editorial. Prose, not bullet points.

Return ONLY the structured JSON object with a "recommendations" array of exactly ${lanes.length} items, one per lane in the given order.`;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: unknown;
}

// One Gemini round-trip with a hard wall-clock timeout, so a hung call fails
// fast instead of stalling the whole generation (and blowing the route limit).
async function callGemini(prompt: string, schema: object, timeoutMs = 60_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/${model()}:generateContent?key=${encodeURIComponent(apiKey())}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 1.0,
          responseMimeType: "application/json",
          responseSchema: schema
        }
      }),
      cache: "no-store",
      signal: controller.signal
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Gemini timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Gemini request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  if (!text) throw new Error("Gemini returned an empty response.");
  return text;
}

export async function generateRecommendationDraft(
  taste: TasteProfile,
  history: { title: string; artist: string }[],
  feedback: FeedbackRecord[]
): Promise<RecommendationDraft> {
  const text = await callGemini(buildPrompt(taste, history, feedback), RESPONSE_SCHEMA);
  try {
    return JSON.parse(text) as RecommendationDraft;
  } catch {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 300)}`);
  }
}

// One pick per requested lane in a single call — the workhorse for the daily
// podium. Each returned draft carries its lane so order survives grounding.
export async function generateRecommendationDrafts(
  taste: TasteProfile,
  history: { title: string; artist: string }[],
  feedback: FeedbackRecord[],
  lanes: Lane[]
): Promise<RecommendationDraft[]> {
  const text = await callGemini(buildBatchPrompt(taste, history, feedback, lanes), BATCH_SCHEMA, 90_000);
  let parsed: { recommendations?: RecommendationDraft[] };
  try {
    parsed = JSON.parse(text) as { recommendations?: RecommendationDraft[] };
  } catch {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 300)}`);
  }
  return Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
}
