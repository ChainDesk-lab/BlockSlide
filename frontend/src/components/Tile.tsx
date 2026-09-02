import type { CSSProperties, TransitionEvent } from "react";

interface TileProps {
  value: number;
  /** Grid position 0..3 — fed to CSS via `--row` / `--col` on the outer element. */
  row: number;
  col: number;
  isNew?: boolean;
  isMerged?: boolean;
  /** Losing side of a merge: slides in, then is removed on transition end. */
  isGhost?: boolean;
  /** Holds the pop-in animation back until the slide has landed (ms). */
  animationDelayMs?: number;
  onTransitionEnd?: () => void;
}

function fontSizeFor(value: number): string {
  if (value < 100)   return "2.6rem";
  if (value < 1000)  return "2rem";
  if (value < 10000) return "1.5rem";
  return "1.1rem";
}

export default function Tile({
  value,
  row,
  col,
  isNew,
  isMerged,
  isGhost,
  animationDelayMs,
  onTransitionEnd,
}: TileProps) {
  if (value === 0) return null;

  // Outer element: position + slide only. Inner element: pop (scale) only.
  // They must stay separate — see the .tile-layer note in index.css.
  const posStyle = { "--row": row, "--col": col } as CSSProperties;

  const innerCls = [
    "tile",
    `tile--${value}`,
    isNew    ? "tile--appear" : "",
    isMerged ? "tile--merged" : "",
    value === 2048 ? "tile--glow" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const innerStyle = {
    fontSize: fontSizeFor(value),
    ...(animationDelayMs ? { animationDelay: `${animationDelayMs}ms` } : null),
  } as CSSProperties;

  const handleTransitionEnd = onTransitionEnd
    ? (e: TransitionEvent<HTMLDivElement>) => {
        // Only the outer .tile-pos's own slide — not a bubbled inner transition.
        if (e.target === e.currentTarget && e.propertyName === "transform") {
          onTransitionEnd();
        }
      }
    : undefined;

  return (
    <div
      className={isGhost ? "tile-pos tile-pos--ghost" : "tile-pos"}
      style={posStyle}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className={innerCls} style={innerStyle}>
        {value}
      </div>
    </div>
  );
}
