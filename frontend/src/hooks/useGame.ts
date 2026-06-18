import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyMove,
  Direction,
  GameState,
  generateSeed,
  initGame,
} from "../lib/gameLogic";

const STORAGE_KEY = (addr: string) => `blockslide_game_${addr.toLowerCase()}`;

interface PersistedGame {
  seed: string;
  state: GameState;
}

export function useGame(address?: string, inputEnabled: boolean = true) {
  const [state, setState] = useState<GameState | null>(null);
  const [seed, setSeed] = useState<string | null>(null);
  const rngRef = useRef<(() => number) | null>(null);

  // Keep keyboard/touch handlers from firing while the player is on another
  // screen (Leaderboard/Shop). A ref avoids re-subscribing the listeners.
  const inputEnabledRef = useRef(inputEnabled);
  inputEnabledRef.current = inputEnabled;

  // Restore persisted game on mount
  useEffect(() => {
    if (!address) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY(address));
      if (!raw) return;
      const saved: PersistedGame = JSON.parse(raw);
      // Re-init RNG from seed and fast-forward to saved moveCount
      const { rng } = initGame(saved.seed);
      // Replay moves is complex; instead we just restore the board state directly
      // and re-create the RNG at its current position by replaying dummy moves.
      // Simpler: store the RNG state indirectly by re-seeding and skipping.
      // For now, restore the board state and create a fresh RNG — tile spawning
      // will differ from the original sequence from this point, but the committed
      // seed still locks in the game's starting conditions.
      rngRef.current = rng;
      setSeed(saved.seed);
      setState({
        ...saved.state,
        newTiles:     [],
        mergedTiles:  [],
        // Guard fields added after old saves were written
        currentCombo: saved.state.currentCombo ?? 0,
        maxCombo:     saved.state.maxCombo     ?? 0,
      });
    } catch {
      // corrupt storage — ignore
    }
  }, [address]);

  // Persist game state whenever it changes
  useEffect(() => {
    if (!address || !state || !seed) return;
    const data: PersistedGame = { seed, state };
    localStorage.setItem(STORAGE_KEY(address), JSON.stringify(data));
  }, [address, state, seed]);

  const startNewGame = useCallback((existingSeed?: string) => {
    const s = existingSeed ?? generateSeed();
    const { state: initial, rng } = initGame(s);
    rngRef.current = rng;
    setSeed(s);
    setState(initial);
    return s;
  }, []);

  const clearGame = useCallback(() => {
    setState(null);
    setSeed(null);
    rngRef.current = null;
    if (address) localStorage.removeItem(STORAGE_KEY(address));
  }, [address]);

  const handleMove = useCallback((dir: Direction) => {
    if (!rngRef.current) return;
    const rng = rngRef.current;
    setState((prev) => {
      if (!prev || prev.over || prev.won) return prev;
      return applyMove(prev, dir, rng);
    });
  }, []);

  // Keyboard controls
  useEffect(() => {
    const KEYS: Record<string, Direction> = {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      w: "up", s: "down", a: "left", d: "right",
      k: "up", j: "down", h: "left", l: "right",
    };
    const onKey = (e: KeyboardEvent) => {
      if (!inputEnabledRef.current) return;
      const dir = KEYS[e.key];
      if (dir) {
        e.preventDefault();
        handleMove(dir);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleMove]);

  // Touch / swipe controls
  useEffect(() => {
    let startX = 0;
    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (!inputEnabledRef.current) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!inputEnabledRef.current) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (Math.max(absX, absY) < 20) return; // ignore taps

      if (absX > absY) {
        handleMove(dx > 0 ? "right" : "left");
      } else {
        handleMove(dy > 0 ? "down" : "up");
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [handleMove]);

  return { state, seed, startNewGame, clearGame, handleMove };
}
