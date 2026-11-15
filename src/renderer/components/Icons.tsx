// Inline stroke icons from the prototype. Decorative unless a label is given.
import type { ReactNode } from 'react';

function Svg({ size = 20, stroke = 'currentColor', width = 2, children }: { size?: number; stroke?: string; width?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const AppMark = () => (
  <Svg size={28} stroke="var(--accent-text)">
    <path d="M4 5h16v11H9l-5 4z" />
    <path d="M9 10.5l2 2 4-4" />
  </Svg>
);
export const Check = () => (
  <Svg stroke="var(--success)" width={2.4}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const Warning = () => (
  <Svg stroke="var(--warn-icon)">
    <path d="M12 3.5l9.5 16.5h-19z" />
    <path d="M12 10v4.5" />
    <path d="M12 17.3v.2" />
  </Svg>
);
export const Phone = () => (
  <Svg size={24}>
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </Svg>
);
export const ChatsIcon = () => (
  <Svg size={22}>
    <path d="M4 5h16v11H9l-5 4z" />
  </Svg>
);
export const BackupIcon = () => (
  <Svg size={22}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4.5h-4.5" />
    <path d="M12 8v4.5l3 1.5" />
  </Svg>
);
export const SearchIcon = () => (
  <Svg stroke="var(--muted)">
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Svg>
);
export const PhotoIcon = () => (
  <Svg size={28} width={1.8}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8.5" cy="10" r="1.5" />
    <path d="M21 16l-5-5-8 8" />
  </Svg>
);
export const PlayCircle = () => (
  <Svg size={34} width={1.8}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M10 8.5v7l6-3.5z" fill="currentColor" />
  </Svg>
);
export const Play = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);
export const Pause = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" />
    <rect x="14" y="5" width="4" height="14" />
  </svg>
);
