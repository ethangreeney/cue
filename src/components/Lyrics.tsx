"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { seekActive } from "./Player";

interface SyncedLine {
  time: number; // seconds
  text: string;
}

interface LyricsData {
  synced: SyncedLine[];
  plain: string | null;
  instrumental: boolean;
}

type State = "loading" | "synced" | "plain" | "none" | "instrumental";

// The one place the lyrics request is shaped — so the daily-page prefetch and
// this component hit the exact same URL and share the browser cache entry.
export function lyricsQuery(title: string, artist: string, album?: string, durationMs?: number): string {
  const params = new URLSearchParams({ title, artist });
  if (album) params.set("album", album);
  if (durationMs) params.set("duration", String(Math.round(durationMs / 1000)));
  return params.toString();
}

export default function Lyrics({
  uri,
  title,
  artist,
  album,
  durationMs,
  positionSec,
  playing
}: {
  uri?: string | null;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  positionSec: number;
  playing: boolean;
}) {
  const [data, setData] = useState<LyricsData | null>(null);
  const [state, setState] = useState<State>("loading");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setData(null);
    fetch(`/api/lyrics?${lyricsQuery(title, artist, album, durationMs)}`)
      .then((r) => r.json() as Promise<LyricsData>)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        if (d.instrumental) setState("instrumental");
        else if (d.synced && d.synced.length) setState("synced");
        else if (d.plain) setState("plain");
        else setState("none");
      })
      .catch(() => {
        if (!cancelled) setState("none");
      });
    return () => {
      cancelled = true;
    };
  }, [title, artist, album, durationMs]);

  const synced = data?.synced ?? [];

  // The last line whose timestamp we've passed is the "current" line. A small
  // lead makes the highlight land with the vocal rather than just after it.
  const activeIdx = useMemo(() => {
    if (state !== "synced") return -1;
    let idx = -1;
    for (let i = 0; i < synced.length; i++) {
      if (synced[i].time <= positionSec + 0.2) idx = i;
      else break;
    }
    return idx;
  }, [synced, positionSec, state]);

  // Keep the active line centered while playing. Scroll the container (not the
  // page) so the rest of the layout stays put.
  useEffect(() => {
    const el = activeRef.current;
    const box = containerRef.current;
    if (!el || !box || activeIdx < 0) return;
    const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
    box.scrollTo({ top: target, behavior: "smooth" });
  }, [activeIdx]);

  if (state === "loading") {
    return (
      <div className="lyrics lyrics-muted">
        <p>Finding lyrics…</p>
      </div>
    );
  }

  if (state === "instrumental") {
    return (
      <div className="lyrics lyrics-muted">
        <p>Instrumental — no lyrics to follow. Just listen.</p>
      </div>
    );
  }

  if (state === "none") {
    return (
      <div className="lyrics lyrics-muted">
        <p>Lyrics aren&rsquo;t available for this one.</p>
      </div>
    );
  }

  if (state === "plain") {
    return (
      <div className="lyrics lyrics-plain" ref={containerRef}>
        {(data?.plain ?? "").split(/\n/).map((line, i) => (
          <p key={i}>{line || " "}</p>
        ))}
      </div>
    );
  }

  return (
    <div className="lyrics lyrics-synced" ref={containerRef}>
      {synced.map((line, i) => {
        const isActive = i === activeIdx;
        const isPast = i < activeIdx;
        return (
          <button
            key={i}
            type="button"
            ref={isActive ? activeRef : null}
            className={`lyric-line${isActive ? " active" : ""}${isPast ? " past" : ""}${
              playing ? "" : " paused"
            }`}
            onClick={() => seekActive(uri ?? null, line.time * 1000)}
          >
            {line.text || " "}
          </button>
        );
      })}
    </div>
  );
}
