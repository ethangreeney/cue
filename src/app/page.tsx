"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import RecommendationCard, { FeedbackPayload } from "@/components/RecommendationCard";
import { SpotifyIcon } from "@/components/icons";
import { FeedbackRecord, Recommendation } from "@/lib/types";

type Phase = "loading" | "connect" | "analyzing" | "ready";

const ANALYZING_LINES = [
  "Reading your taste…",
  "Listening for patterns…",
  "Finding the one song…",
  "Writing the liner notes…"
];

export default function Home() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [displayName, setDisplayName] = useState<string>("");
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineIdx, setLineIdx] = useState(0);
  const [todayLabel, setTodayLabel] = useState("");

  // Session memory — lives only in this tab. Closing it forgets everything.
  const historyRef = useRef<{ title: string; artist: string }[]>([]);
  const feedbackRef = useRef<FeedbackRecord[]>([]);

  useEffect(() => {
    const d = new Date();
    setTodayLabel(`${d.getDate()} ${d.toLocaleString("en-US", { month: "long" })}`);
  }, []);

  // rotate analyzing lines
  useEffect(() => {
    if (phase !== "analyzing") return;
    const t = setInterval(() => setLineIdx((i) => (i + 1) % ANALYZING_LINES.length), 1800);
    return () => clearInterval(t);
  }, [phase]);

  // surface oauth errors passed back via query string
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) {
      setError(decodeURIComponent(err));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Ask for the next song, sending along what we've already shown and how the
  // listener has reacted this session.
  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history: historyRef.current.slice(-14),
          feedback: feedbackRef.current.slice(-8)
        })
      });
      const data = (await res.json()) as { recommendation?: Recommendation; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not generate a recommendation.");
      const next = data.recommendation ?? null;
      if (next) {
        historyRef.current.push({ title: next.title, artist: next.artist });
      }
      setRec(next);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("ready");
    } finally {
      setBusy(false);
    }
  }, []);

  const init = useCallback(async () => {
    try {
      const res = await fetch("/api/me");
      const data = (await res.json()) as { authenticated?: boolean; displayName?: string };
      if (!data.authenticated) {
        setPhase("connect");
        return;
      }
      setDisplayName(data.displayName || "");
      setPhase("analyzing");
      await generate();
    } catch {
      setPhase("connect");
    }
  }, [generate]);

  useEffect(() => {
    init();
  }, [init]);

  // Record the reaction in session memory, then fetch the next pick.
  const handleFeedback = useCallback(
    async (payload: FeedbackPayload) => {
      // Lock immediately so a fast second tap can't fire a parallel request
      // during the visual beat below.
      setBusy(true);
      setError(null);
      if (rec) {
        feedbackRef.current.push({
          recommendationId: rec.id,
          title: rec.title,
          artist: rec.artist,
          verdict: payload.verdict,
          note: payload.note,
          at: new Date().toISOString()
        });
      }
      // brief beat so the selection registers visually
      await new Promise((r) => setTimeout(r, 450));
      await generate();
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [rec, generate]
  );

  const handleAnother = useCallback(async () => {
    await generate();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [generate]);

  // ----- Renders -----
  if (phase === "loading") {
    return (
      <main className="page">
        <div className="analyzing">
          <div className="pulse">cue</div>
        </div>
      </main>
    );
  }

  if (phase === "connect") {
    return (
      <main className="page">
        <header className="masthead">
          <div className="wordmark">cue</div>
        </header>
        <div className="connect">
          {error && <div className="error-banner">Couldn&rsquo;t connect: {error}</div>}
          <h1>
            One song, <em>chosen</em> for you.
          </h1>
          <p>
            Not a playlist. Not a feed. Each day, one song pulled from your listening history and
            explained — a thesis, the reasoning, the story behind it, and what to listen for.
          </p>
          <a className="btn-primary" href="/api/login">
            <SpotifyIcon size={18} /> Connect Spotify
          </a>
          <p className="connect-note">
            Cue reads your top artists, tracks, and saved songs to understand your taste. It only
            uses Spotify to play and save — the discovery and context happen here.
          </p>
        </div>
      </main>
    );
  }

  if (phase === "analyzing") {
    return (
      <main className="page">
        <header className="masthead">
          <div className="wordmark">cue</div>
        </header>
        <div className="analyzing">
          <div className="pulse">Curating</div>
          <div className="line">{ANALYZING_LINES[lineIdx]}</div>
        </div>
      </main>
    );
  }

  // ready
  return (
    <main className="page">
      {busy && (
        <div className="overlay-busy">
          <div className="line">Choosing your next song…</div>
        </div>
      )}
      <header className="masthead">
        <div className="wordmark">cue</div>
        <div className="masthead-right">
          <span className="label">Today</span>
          <span className="today-date">{todayLabel}</span>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {rec ? (
        <RecommendationCard
          rec={rec}
          busy={busy}
          onFeedback={handleFeedback}
          onAnother={handleAnother}
        />
      ) : (
        <div className="analyzing">
          <div className="line">No song yet.</div>
          <button className="btn-primary" style={{ marginTop: 24 }} onClick={handleAnother}>
            Find a song
          </button>
        </div>
      )}
    </main>
  );
}
