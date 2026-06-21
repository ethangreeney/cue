"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import RecommendationCard, { FeedbackPayload } from "@/components/RecommendationCard";
import { SpotifyIcon } from "@/components/icons";
import { FeedbackRecord, FeedbackVerdict, Recommendation } from "@/lib/types";

type Phase = "loading" | "connect" | "generating" | "ready";
type DailyCache = { key: string; recommendations: Recommendation[] };

const REFRESH_HOUR = 8;
const PICK_COUNT = 3;

function localDateKey(date: Date): string {
  const boundary = new Date(date);
  if (boundary.getHours() < REFRESH_HOUR) boundary.setDate(boundary.getDate() - 1);
  const year = boundary.getFullYear();
  const month = String(boundary.getMonth() + 1).padStart(2, "0");
  const day = String(boundary.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextRefresh(date: Date): Date {
  const next = new Date(date);
  next.setHours(REFRESH_HOUR, 0, 0, 0);
  if (date >= next) next.setDate(next.getDate() + 1);
  return next;
}

function formatCountdown(now: Date): string {
  const remaining = Math.max(0, nextRefresh(now).getTime() - now.getTime());
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function ReactionIcon({ type }: { type: "like" | "pass" }) {
  if (type === "like") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20.2 4.8 13A4.8 4.8 0 0 1 11.6 6.2l.4.4.4-.4A4.8 4.8 0 0 1 19.2 13Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 7 5 5-5 5M15 7v10" />
    </svg>
  );
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [displayName, setDisplayName] = useState("");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [clock, setClock] = useState(() => new Date());
  const [reactions, setReactions] = useState<Record<string, FeedbackVerdict>>({});
  const bootedRef = useRef(false);
  const activeKeyRef = useRef(localDateKey(new Date()));
  const displayNameRef = useRef("");

  const historyKey = (name: string) => `cue:history:${name}`;
  const feedbackKey = (name: string) => `cue:feedback:${name}`;
  const dailyKey = (name: string, key: string) => `cue:daily:${name}:${key}`;

  const generateDailyPicks = useCallback(async (name: string, key: string) => {
    activeKeyRef.current = key;
    setPhase("generating");
    setGeneratedCount(0);
    setError(null);

    const storedHistory = readStored<{ title: string; artist: string }[]>(historyKey(name), []);
    const storedFeedback = readStored<FeedbackRecord[]>(feedbackKey(name), []);
    const history = storedHistory.slice(-14);
    const picks: Recommendation[] = [];

    try {
      for (let index = 0; index < PICK_COUNT; index++) {
        const response = await fetch("/api/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ history: [...history, ...picks.map(({ title, artist }) => ({ title, artist }))], feedback: storedFeedback.slice(-8) })
        });
        const data = (await response.json()) as { recommendation?: Recommendation; error?: string };
        if (!response.ok || !data.recommendation) {
          throw new Error(data.error || "Could not create today’s picks.");
        }
        picks.push(data.recommendation);
        setGeneratedCount(picks.length);
      }

      const cache: DailyCache = { key, recommendations: picks };
      window.localStorage.setItem(dailyKey(name, key), JSON.stringify(cache));
      window.localStorage.setItem(
        historyKey(name),
        JSON.stringify([...history, ...picks.map(({ title, artist }) => ({ title, artist }))].slice(-14))
      );
      activeKeyRef.current = key;
      setRecommendations(picks);
      setSelectedIndex(null);
      setPhase("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create today’s picks.");
      setPhase("ready");
    }
  }, []);

  const initialise = useCallback(async () => {
    try {
      const response = await fetch("/api/me");
      const data = (await response.json()) as { authenticated?: boolean; displayName?: string };
      if (!data.authenticated) {
        setPhase("connect");
        return;
      }

      const name = data.displayName || "Listener";
      const key = localDateKey(new Date());
      displayNameRef.current = name;
      activeKeyRef.current = key;
      setDisplayName(name);

      const savedFeedback = readStored<FeedbackRecord[]>(feedbackKey(name), []);
      setReactions(
        Object.fromEntries(
          savedFeedback
            .filter((item): item is FeedbackRecord & { verdict: FeedbackVerdict } => Boolean(item.verdict))
            .map((item) => [item.recommendationId, item.verdict])
        )
      );

      const cached = readStored<DailyCache | null>(dailyKey(name, key), null);
      if (cached?.key === key && cached.recommendations.length === PICK_COUNT) {
        setRecommendations(cached.recommendations);
        setPhase("ready");
        return;
      }

      await generateDailyPicks(name, key);
    } catch {
      setPhase("connect");
    }
  }, [generateDailyPicks]);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void initialise();
  }, [initialise]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      setClock(now);
      const key = localDateKey(now);
      if (
        phase === "ready" &&
        displayNameRef.current &&
        key !== activeKeyRef.current
      ) {
        void generateDailyPicks(displayNameRef.current, key);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generateDailyPicks, phase]);

  const recordFeedback = useCallback((rec: Recommendation, payload: FeedbackPayload) => {
    const name = displayNameRef.current;
    if (!name) return;
    const stored = readStored<FeedbackRecord[]>(feedbackKey(name), []);
    const record: FeedbackRecord = {
      recommendationId: rec.id,
      title: rec.title,
      artist: rec.artist,
      verdict: payload.verdict,
      note: payload.note,
      at: new Date().toISOString()
    };
    window.localStorage.setItem(
      feedbackKey(name),
      JSON.stringify([...stored.filter((item) => item.recommendationId !== rec.id), record].slice(-24))
    );
    if (payload.verdict) {
      setReactions((current) => ({ ...current, [rec.id]: payload.verdict! }));
    }
  }, []);

  const handleDetailFeedback = useCallback(
    async (payload: FeedbackPayload) => {
      if (selectedIndex === null) return;
      recordFeedback(recommendations[selectedIndex], payload);
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      setSelectedIndex((selectedIndex + 1) % recommendations.length);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [recommendations, recordFeedback, selectedIndex]
  );

  const showNextDetail = useCallback(() => {
    if (selectedIndex === null) return;
    setSelectedIndex((selectedIndex + 1) % recommendations.length);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [recommendations.length, selectedIndex]);

  if (phase === "loading") {
    return (
      <main className="page">
        <div className="analyzing"><div className="pulse">cue</div></div>
      </main>
    );
  }

  if (phase === "connect") {
    return (
      <main className="page">
        <header className="masthead"><div className="wordmark">cue</div></header>
        <div className="connect">
          <h1>One song, <em>chosen</em> for you.</h1>
          <p>Three considered picks each day, drawn from your listening history and explained with enough context to make each song matter.</p>
          <a className="btn-primary" href="/api/login"><SpotifyIcon size={18} /> Connect Spotify</a>
          <p className="connect-note">Cue reads your top artists, tracks, and saved songs to understand your taste.</p>
        </div>
      </main>
    );
  }

  if (phase === "generating") {
    return (
      <main className="page">
        <header className="masthead"><div className="wordmark">cue</div></header>
        <div className="analyzing">
          <div className="pulse">Curating</div>
          <div className="line">Choosing pick {Math.min(generatedCount + 1, PICK_COUNT)} of {PICK_COUNT}…</div>
        </div>
      </main>
    );
  }

  if (selectedIndex !== null && recommendations[selectedIndex]) {
    const selected = recommendations[selectedIndex];
    return (
      <main className="page">
        <header className="masthead">
          <button className="wordmark wordmark-button" onClick={() => setSelectedIndex(null)}>cue</button>
          <div className="masthead-right">
            <button className="back-to-picks" onClick={() => setSelectedIndex(null)}>All picks</button>
            <span className="label">Today</span>
            <span className="today-date">{selected.dateLabel}</span>
          </div>
        </header>
        <RecommendationCard
          key={selected.id}
          rec={selected}
          busy={false}
          onFeedback={handleDetailFeedback}
          onAnother={showNextDetail}
        />
      </main>
    );
  }

  const firstName = displayName.split(/\s+/)[0] || "Listener";
  const dateLabel = clock.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const timeLabel = clock.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <main className="daily-page">
      <header className="daily-header">
        <div className="daily-wordmark">cue<span>·</span></div>
        <p className="daily-date">{dateLabel} <span>·</span> {timeLabel}</p>
        <h1>Here are today&rsquo;s picks, {firstName}.</h1>
        <p className="daily-intro">Three songs, each chosen for a different part of your day.</p>
      </header>

      {error ? (
        <div className="daily-error">
          <p>{error}</p>
          <button onClick={() => void generateDailyPicks(displayName, localDateKey(new Date()))}>Try again</button>
        </div>
      ) : (
        <section className="picks" aria-label="Today’s song picks">
          {recommendations.map((pick, index) => (
            <article
              className="pick"
              key={pick.id}
              role="link"
              tabIndex={0}
              aria-label={`Open ${pick.title} by ${pick.artist}`}
              onClick={() => setSelectedIndex(index)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedIndex(index);
                }
              }}
            >
              <div className={`pick-cover ${pick.spotify?.albumImage ? "" : ["cover-dawn", "cover-signal", "cover-night"][index % 3]}`}>
                {pick.spotify?.albumImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pick.spotify.albumImage} alt={`${pick.album} cover`} />
                ) : (
                  <><span className="cover-index">0{index + 1}</span><span className="cover-mark" /></>
                )}
              </div>

              <div className="pick-copy">
                <p className="pick-number">Pick 0{index + 1}</p>
                <h2>{pick.title}</h2>
                <p className="pick-artist">{pick.artist}</p>
                <p className="pick-note">{pick.thesis}</p>
              </div>

              <div className="pick-actions" aria-label={`Actions for ${pick.title}`}>
                <button
                  type="button"
                  className={reactions[pick.id] === "loved" ? "active" : ""}
                  aria-label={`Like ${pick.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    recordFeedback(pick, { verdict: "loved" });
                  }}
                >
                  <ReactionIcon type="like" /><span>Like</span>
                </button>
                <span className="action-rule" />
                <button
                  type="button"
                  className={reactions[pick.id] === "not_for_me" ? "active" : ""}
                  aria-label={`Pass ${pick.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    recordFeedback(pick, { verdict: "not_for_me" });
                  }}
                >
                  <ReactionIcon type="pass" /><span>Pass</span>
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      <footer className="daily-footer">
        <span />
        <p>New picks in <strong>{formatCountdown(clock)}</strong> · refreshes at 8:00 AM</p>
        <span />
      </footer>
    </main>
  );
}
