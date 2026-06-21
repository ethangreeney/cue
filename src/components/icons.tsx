// Minimal line icons drawn to match the calm editorial aesthetic.
import React from "react";

type P = { size?: number; className?: string };
const base = (size = 16): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const
});

export const NoteIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 18V5l11-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  </svg>
);

export const PersonIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.5-7 8-7s8 3 8 7" />
  </svg>
);

export const WaveIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 12h2l2-6 3 14 3-18 3 14 2-4h3" />
  </svg>
);

export const GlobeIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
  </svg>
);

export const PlayIcon = ({ size = 22, className }: P) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    style={{ marginLeft: 3 }}
  >
    <path d="M8 5v14l11-7z" />
  </svg>
);

export const PauseIcon = ({ size = 22, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

export const ArrowIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const RestartIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

export const SpotifyIcon = ({ size = 18, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.6 14.4a.62.62 0 0 1-.86.21c-2.35-1.44-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.21c3.81-.87 7.08-.5 9.72 1.1.3.18.39.57.21.86zm1.23-2.74a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.17a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.56 11.24 1.33.37.23.49.71.25 1.07zm.11-2.85C14.72 8.96 9.5 8.78 6.46 9.7a.93.93 0 1 1-.54-1.78c3.49-1.06 9.25-.85 12.9 1.31a.93.93 0 1 1-.95 1.6z" />
  </svg>
);

export const MicIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

// Feedback glyphs
export const HeartIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5C19 15.5 12 20 12 20z" />
  </svg>
);

export const TargetIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" />
    <circle cx="12" cy="12" r="0.6" fill="currentColor" />
  </svg>
);

export const ObviousIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4" />
  </svg>
);

export const WeirdIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 13c1.5 0 1.5-3 3-3s1.5 4 3 4 1.5-5 3-5 1.5 4 3 4 1.5-3 3-3" />
  </svg>
);

export const BoringIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 12h16" />
  </svg>
);

export const NotForMeIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M7 7l10 10M17 7L7 17" />
  </svg>
);
