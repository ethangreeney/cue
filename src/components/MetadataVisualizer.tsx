"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export default function MetadataVisualizer({
  title,
  artist,
  durationMs,
  positionSec,
  playing
}: {
  title: string;
  artist: string;
  durationMs?: number;
  positionSec: number;
  playing: boolean;
}) {
  const seed = useMemo(() => hash(`${artist}:${title}:${durationMs ?? 0}`), [artist, title, durationMs]);
  const anchor = useRef({ position: positionSec, at: 0 });
  const [time, setTime] = useState(positionSec);

  useEffect(() => {
    anchor.current = { position: positionSec, at: performance.now() };
    setTime(positionSec);
  }, [positionSec, playing]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const elapsed = (performance.now() - anchor.current.at) / 1000;
      setTime(anchor.current.position + elapsed);
    }, 80);
    return () => window.clearInterval(id);
  }, [playing]);

  const bars = useMemo(() => {
    const bpm = 82 + (seed % 48);
    const beat = (time * bpm) / 60;
    const pulse = Math.pow((Math.cos(beat * Math.PI * 2) + 1) / 2, 5);
    return Array.from({ length: 32 }, (_, index) => {
      const character = (Math.imul(seed ^ Math.imul(index + 1, 2654435761), 2246822519) >>> 0) / 4294967295;
      const lowBias = 1 - index / 32;
      const drift = (Math.sin(time * (0.75 + character) + index * 1.31) + 1) / 2;
      const detail = (Math.sin(time * 2.1 + index * 0.67 + character * 4) + 1) / 2;
      const energy = 0.08 + character * 0.34 + drift * 0.24 + detail * 0.14 + pulse * lowBias * 0.4;
      return Math.round(4 + Math.min(1, energy) * 42);
    });
  }, [seed, time]);

  return (
    <div className={`metadata-visualizer${playing ? " playing" : ""}`} aria-label="Song visualizer">
      <div className="visualizer-bars" aria-hidden="true">
        {bars.map((height, index) => (
          <i key={index} style={{ height }} />
        ))}
      </div>
    </div>
  );
}
