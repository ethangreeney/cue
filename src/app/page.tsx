"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import SongStory from "@/components/SongStory";
import Podium from "@/components/Podium";
import { SpotifyIcon } from "@/components/icons";
import { FeedbackRecord, Recommendation } from "@/lib/types";

type Phase = "loading" | "connect" | "generating" | "ready";

function nextMidnight(date: Date): Date {
  const next = new Date(date);
  next.setHours(24, 0, 0, 0);
  return next;
}

function formatCountdown(now: Date): string {
  const remaining = Math.max(0, nextMidnight(now).getTime() - now.getTime());
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

export default function Home() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [displayName, setDisplayName] = useState("");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const bootedRef = useRef(false);
  const activeKeyRef = useRef("");

  const load = useCallback(async () => {
    setPhase("generating");
    setError(null);
    try {
      // One-time migration: hand the server whatever the browser was holding.
      const name = displayName || readStored<string>("cue:lastName", "");
      const seedHistory = name ? readStored<{ title: string; artist: string }[]>(`cue:history:${name}`, []) : [];
      const seedFeedback = name ? readStored<FeedbackRecord[]>(`cue:feedback:${name}`, []) : [];

      const res = await fetch("/api/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seedHistory, seedFeedback })
      });
      const data = (await res.json()) as {
        displayName?: string;
        key?: string;
        recommendations?: Recommendation[];
        error?: string;
      };
      if (!res.ok || !data.recommendations) {
        throw new Error(data.error || "Could not load today’s picks.");
      }
      if (data.displayName) {
        setDisplayName(data.displayName);
        window.localStorage.setItem("cue:lastName", JSON.stringify(data.displayName));
      }
      setRecommendations(data.recommendations);
      activeKeyRef.current = data.key ?? "";
      setPhase("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load today’s picks.");
      setPhase("ready");
    }
  }, [displayName]);

  const initialise = useCallback(async () => {
    try {
      const response = await fetch("/api/me");
      const data = (await response.json()) as { authenticated?: boolean; displayName?: string };
      if (!data.authenticated) {
        setPhase("connect");
        return;
      }
      if (data.displayName) setDisplayName(data.displayName);
      await load();
    } catch {
      setPhase("connect");
    }
  }, [load]);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void initialise();
  }, [initialise]);

  // Tick the countdown, and when midnight rolls past while the tab is open,
  // pull the fresh day's picks.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      setClock(now);
      if (phase === "ready" && activeKeyRef.current && formatCountdown(now) === "00:00:00") {
        void load();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [load, phase]);

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
          <div className="line">Choosing today’s three…</div>
        </div>
      </main>
    );
  }

  const selected = selectedId ? recommendations.find((r) => r.id === selectedId) : null;
  if (selected) {
    return (
      <main className="page story-page">
        <header className="masthead">
          <button className="wordmark wordmark-button" onClick={() => setSelectedId(null)}>cue</button>
          <div className="masthead-right">
            <button className="back-to-picks" onClick={() => setSelectedId(null)}>Back to today</button>
            <span className="label">Today</span>
            <span className="today-date">{selected.dateLabel}</span>
          </div>
        </header>
        <SongStory key={selected.id} rec={selected} />
      </main>
    );
  }

  const firstName = displayName.split(/\s+/)[0] || "Listener";
  const dateLabel = clock.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <main className="daily-page">
      <header className="daily-header">
        <div className="daily-wordmark">cue<span>·</span></div>
        <p className="daily-date">{dateLabel}</p>
        <h1>Today&rsquo;s three, {firstName}.</h1>
        <p className="daily-intro">Chosen for you. Tap any one to read its story and listen.</p>
      </header>

      {error ? (
        <div className="daily-error">
          <p>{error}</p>
          <button onClick={() => void load()}>Try again</button>
        </div>
      ) : (
        <Podium recommendations={recommendations} onOpen={(id) => setSelectedId(id)} />
      )}

      <footer className="daily-footer">
        <span />
        <p>New picks in <strong>{formatCountdown(clock)}</strong> · arrives at midnight</p>
        <span />
      </footer>
    </main>
  );
}
