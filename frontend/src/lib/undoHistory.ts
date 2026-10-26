/**
 * One-step undo for the 2048 board.
 *
 * Tile spawns come from a seeded PRNG (gameLogic.ts) that is a running
 * closure, not part of GameState. Restoring only the board would leave the
 * PRNG one spawn ahead, so undoing and replaying the same move would spawn a
 * different tile — a free re-roll. Instead every RNG draw is counted, the
 * snapshot records how many draws had happened before the move, and undo
 * rebuilds the PRNG from the seed and fast-forwards it to exactly that point.
 * Replaying the same move after an undo therefore gives the same result.
 */
import { applyMove, initGame, type Direction, type GameState } from "./gameLogic";

export interface CountedRng {
  rng: () => number;
  /** Draws taken since initGame finished spawning the opening tiles. */
  calls: () => number;
}

/**
 * The game's PRNG for `seed`, positioned `skip` draws after the opening
 * tiles, with every further draw counted.
 */
export function countedRng(seed: string, skip = 0): CountedRng {
  const { rng: base } = initGame(seed);
  for (let i = 0; i < skip; i++) base();
  let n = skip;
  return {
    rng: () => {
      n++;
      return base();
    },
    calls: () => n,
  };
}

export interface UndoSnapshot {
  /** The state before the last move. */
  state: GameState;
  /** RNG draws taken before the last move. */
  rngCalls: number;
}

/** Apply a move; returns the snapshot to undo it, or null if nothing changed. */
export function moveWithUndo(
  prev: GameState,
  dir: Direction,
  counted: CountedRng,
): { next: GameState; snapshot: UndoSnapshot | null } {
  const before = counted.calls();
  const next = applyMove(prev, dir, counted.rng);
  // applyMove only advances moveCount when the board actually changed.
  if (next.moveCount === prev.moveCount) return { next, snapshot: null };
  return { next, snapshot: { state: prev, rngCalls: before } };
}

/** Whether `state` can be undone at all: a move to take back, and not a win. */
export function canUndoFrom(state: GameState | null, snapshot: UndoSnapshot | null): boolean {
  return !!state && !!snapshot && !state.won;
}

/** The state and PRNG to resume from after undoing the last move. */
export function undoTo(seed: string, snapshot: UndoSnapshot): { state: GameState; counted: CountedRng } {
  return {
    state: { ...snapshot.state, newTiles: [], mergedTiles: [] },
    counted: countedRng(seed, snapshot.rngCalls),
  };
}

/**
 * How Undo spends credits.
 *  - "at_submit": the contract supports submitScoreWithUndos. Undo is instant
 *    and local; the number used is sent with the score and deducted in that
 *    same transaction, like an XP boost.
 *  - "per_use": older contract. Each undo is its own consumeUndo transaction.
 *  - "unknown": still checking which contract is live — Undo waits.
 */
export type UndoMode = "at_submit" | "per_use" | "unknown";

export function undoModeFrom(read: { status: "pending" | "error" | "success"; data?: unknown }): UndoMode {
  if (read.status === "success") return read.data === true ? "at_submit" : "per_use";
  if (read.status === "error") return "per_use"; // the function doesn't exist on the live contract
  return "unknown";
}

/** Credits the player can still use in this game. */
export function undosAvailable(credits: bigint, usedThisGame: number, mode: UndoMode): bigint {
  if (mode !== "at_submit") return credits;
  const left = credits - BigInt(usedThisGame);
  return left > 0n ? left : 0n;
}
