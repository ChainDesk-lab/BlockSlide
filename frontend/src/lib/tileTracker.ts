/**
 * Presentation-layer tile-identity tracker.
 *
 * The board in `gameLogic.ts` is a flat `number[16]` that is recomputed from
 * scratch every move, so React (keying tiles by grid index) can only ever
 * repaint a cell in place — nothing visibly slides. This module diffs two
 * consecutive `GameState` snapshots and assigns every tile a STABLE id so the
 * renderer can animate motion, merges and spawns.
 *
 * It is strictly read-only over `GameState`: it never re-decides a merge, a
 * score or an RNG draw. The final value shown for any cell is always read back
 * from `nextState.board` (ground truth); the mirrored slide walk here only
 * decides *identity* and *choreography*. A bug in this file can therefore only
 * ever produce a wrong animation, never a wrong number.
 */
import type { Direction, GameState } from "./gameLogic";

/** Slide transition duration. Shared with the CSS custom property in index.css
 *  and the merge-reveal / ghost-cleanup timing so JS and CSS can't drift.
 *  Long enough to clearly read the direction, short enough to stay snappy. */
export const SLIDE_MS = 140;
/** Spawn pop is held back this long so it doesn't read as another sliding tile. */
export const SPAWN_STAGGER_MS = 90;

export interface RenderTile {
  id: number;
  value: number;
  row: number;
  col: number;
  /** Freshly spawned this move — immediate pop-in. */
  isNew?: boolean;
  /** Result of a merge this move — revealed once the ghosts finish sliding. */
  isMerged?: boolean;
}

/** A losing side of a merge: slides to the merge cell at its old value, then is
 *  removed once its transition ends (covered by the merged-result tile). */
export interface Ghost {
  id: number;
  value: number;
  row: number;
  col: number;
}

/** prev board index -> the tile currently occupying it. Nonzero cells only. */
export type Ledger = Map<number, { id: number; value: number }>;

export interface TrackerPrev {
  /** Reference to the previous snapshot's `board` — used only for identity. */
  board: GameState["board"];
  ledger: Ledger;
  tiles: RenderTile[];
  ghosts: Ghost[];
}

export interface Transition {
  tiles: RenderTile[];
  ghosts: Ghost[];
  ledger: Ledger;
}

/**
 * Board index for position `pos` (0..3, in slide order) of line `line` (0..3)
 * when sliding in `dir`. Pure row-major 4x4 geometry — mirrors the private
 * `extractLine` / `toBoardIdx` in gameLogic (verified equivalent for all four
 * directions), duplicated here so gameLogic stays untouched. Encodes no rule.
 */
export function boardIdx(dir: Direction, line: number, pos: number): number {
  switch (dir) {
    case "left":  return line * 4 + pos;
    case "right": return line * 4 + (3 - pos);
    case "up":    return pos * 4 + line;
    case "down":  return (3 - pos) * 4 + line;
  }
}

const rowOf = (idx: number) => Math.floor(idx / 4);
const colOf = (idx: number) => idx % 4;

function ledgerFromBoard(board: GameState["board"], nextId: () => number): Ledger {
  const ledger: Ledger = new Map();
  board.forEach((v, idx) => {
    if (v !== 0) ledger.set(idx, { id: nextId(), value: v });
  });
  return ledger;
}

function tilesFromLedger(ledger: Ledger): RenderTile[] {
  const tiles: RenderTile[] = [];
  ledger.forEach(({ id, value }, idx) => {
    tiles.push({ id, value, row: rowOf(idx), col: colOf(idx) });
  });
  return tiles;
}

/**
 * Derive the render tiles / ghosts for the move that produced `nextState` from
 * `prev`.
 *
 * - `prev === null`  → component just mounted: place instantly, no animation
 *   (covers first load, a restored game, and a tab-switch remount — `GameState`
 *   alone can't tell these apart, so none of them animate).
 * - `nextState.board === prev.board` → no-op or terminal move: nothing changed.
 * - `nextState.moveCount === 0` with a `prev` → New Game while still mounted:
 *   reset the ledger and pop the two starting tiles in.
 * - otherwise → a real tracked slide (`dir` required).
 */
export function computeTransition(
  prev: TrackerPrev | null,
  nextState: GameState,
  dir: Direction | null,
  nextId: () => number,
  opts: { reducedMotion?: boolean } = {},
): Transition {
  const { reducedMotion = false } = opts;

  if (!prev) {
    const ledger = ledgerFromBoard(nextState.board, nextId);
    return { tiles: tilesFromLedger(ledger), ghosts: [], ledger };
  }

  if (nextState.board === prev.board) {
    return { tiles: prev.tiles, ghosts: prev.ghosts, ledger: prev.ledger };
  }

  if (nextState.moveCount === 0) {
    const ledger = ledgerFromBoard(nextState.board, nextId);
    const fresh = new Set(nextState.newTiles);
    const tiles = tilesFromLedger(ledger).map((t) =>
      fresh.has(t.row * 4 + t.col) ? { ...t, isNew: true } : t,
    );
    return { tiles, ghosts: [], ledger };
  }

  if (!dir) {
    const ledger = ledgerFromBoard(nextState.board, nextId);
    return { tiles: tilesFromLedger(ledger), ghosts: [], ledger };
  }

  const ledger: Ledger = new Map();
  const tiles: RenderTile[] = [];
  const ghosts: Ghost[] = [];
  const mergeDests = new Set<number>();

  for (let line = 0; line < 4; line++) {
    // Previous tiles in this line, in slide order — mirrors `row.filter(v => v !== 0)`.
    const seq: { id: number; value: number }[] = [];
    for (let pos = 0; pos < 4; pos++) {
      const e = prev.ledger.get(boardIdx(dir, line, pos));
      if (e) seq.push(e);
    }

    // Same greedy walk as gameLogic's slideRow: equal neighbours merge and the
    // pair is consumed (skip 2); everything else carries (skip 1). Deterministic
    // over the same input, so it reproduces the grouping already committed to
    // nextState.board.
    let i = 0;
    let outPos = 0;
    while (i < seq.length) {
      const destIdx = boardIdx(dir, line, outPos);
      const row = rowOf(destIdx);
      const col = colOf(destIdx);
      const value = nextState.board[destIdx]; // ground truth, never computed here

      if (i + 1 < seq.length && seq[i].value === seq[i + 1].value) {
        ghosts.push({ id: seq[i].id, value: seq[i].value, row, col });
        ghosts.push({ id: seq[i + 1].id, value: seq[i + 1].value, row, col });
        const id = nextId();
        tiles.push({ id, value, row, col, isMerged: true });
        ledger.set(destIdx, { id, value });
        mergeDests.add(destIdx);
        i += 2;
      } else {
        tiles.push({ id: seq[i].id, value, row, col });
        ledger.set(destIdx, { id: seq[i].id, value });
        i += 1;
      }
      outPos++;
    }
  }

  for (const idx of nextState.newTiles) {
    const id = nextId();
    const value = nextState.board[idx];
    tiles.push({ id, value, row: rowOf(idx), col: colOf(idx), isNew: true });
    ledger.set(idx, { id, value });
  }

  if (process.env.NODE_ENV !== "production") {
    const expected = new Set(nextState.mergedTiles);
    const mismatch =
      expected.size !== mergeDests.size ||
      [...mergeDests].some((d) => !expected.has(d));
    if (mismatch) {
      // Not fatal — the numbers on screen still come from nextState.board.
      // eslint-disable-next-line no-console
      console.warn(
        "[tileTracker] merge-destination mismatch vs gameLogic",
        { computed: [...mergeDests], expected: [...expected], dir },
      );
    }
  }

  return {
    tiles,
    ghosts: reducedMotion ? [] : ghosts,
    ledger,
  };
}
