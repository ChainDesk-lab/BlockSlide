import { useCallback, useEffect, useRef, useState } from "react";
import type { Direction, GameState } from "../lib/gameLogic";
import {
  computeTransition,
  SLIDE_MS,
  type Ghost,
  type Ledger,
  type RenderTile,
} from "../lib/tileTracker";

interface Snapshot {
  state: GameState;
  ledger: Ledger;
  tiles: RenderTile[];
  ghosts: Ghost[];
}

const EMPTY: ReadonlySet<number> = new Set();

function initialReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Turns the plain `GameState` into an identity-tracked list of tiles the board
 * can animate. `useGame` owns the game; this hook owns nothing but the visual
 * bookkeeping (stable ids, in-flight merge ghosts, reduced-motion).
 */
export function useAnimatedTiles(
  state: GameState | null,
  lastDirection: Direction | null,
): {
  liveTiles: RenderTile[];
  ghosts: Ghost[];
  dismissGhost: (id: number) => void;
  reducedMotion: boolean;
} {
  const idCounter = useRef(0);
  const nextId = useRef(() => (idCounter.current += 1)).current;
  const snapRef = useRef<Snapshot | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(EMPTY);
  const [reducedMotion, setReducedMotion] = useState(initialReducedMotion);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // ── Reconcile during render (StrictMode-safe: the guard makes the double
  //    invocation a no-op, so ids are minted exactly once per move). ──────────
  if (!state) {
    snapRef.current = null;
  } else if (snapRef.current?.state !== state) {
    const prev = snapRef.current;
    const { tiles, ghosts, ledger } = computeTransition(
      prev
        ? { board: prev.state.board, ledger: prev.ledger, tiles: prev.tiles, ghosts: prev.ghosts }
        : null,
      state,
      lastDirection,
      nextId,
      { reducedMotion },
    );
    snapRef.current = { state, ledger, tiles, ghosts };
    // Stale ghost ids can never come back (ids are monotonic); drop them so the
    // set doesn't grow across a long game.
    if (dismissed !== EMPTY) setDismissed(EMPTY);
  }

  // Fallback cleanup: reduced-motion (or a merge whose ghost never actually
  // moves) means `transitionend` won't fire, so time the ghosts out too.
  useEffect(() => {
    const ghosts = snapRef.current?.ghosts;
    if (!ghosts || ghosts.length === 0) return;
    const t = window.setTimeout(() => {
      setDismissed((prev) => {
        const next = new Set(prev);
        for (const g of ghosts) next.add(g.id);
        return next;
      });
    }, SLIDE_MS + 80);
    return () => window.clearTimeout(t);
  }, [state]);

  const dismissGhost = useCallback((id: number) => {
    setDismissed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const snap = snapRef.current;
  return {
    liveTiles: snap?.tiles ?? [],
    ghosts: (snap?.ghosts ?? []).filter((g) => !dismissed.has(g.id)),
    dismissGhost,
    reducedMotion,
  };
}
