import { describe, expect, it } from "vitest";
import { applyMove, initGame, type Direction, type GameState } from "./gameLogic";
import { boardIdx, computeTransition, type Ledger, type TrackerPrev } from "./tileTracker";

let seq = 0;
const nextId = () => (seq += 1);

function mkState(board: number[], patch: Partial<GameState> = {}): GameState {
  return {
    board,
    score: 0,
    highestTile: Math.max(0, ...board),
    moveCount: 1,
    over: false,
    won: false,
    newTiles: [],
    mergedTiles: [],
    currentCombo: 0,
    maxCombo: 0,
    ...patch,
  };
}

function ledgerOf(board: number[]): Ledger {
  const l: Ledger = new Map();
  board.forEach((v, i) => {
    if (v !== 0) l.set(i, { id: nextId(), value: v });
  });
  return l;
}

function prevOf(board: number[]): TrackerPrev {
  return { board, ledger: ledgerOf(board), tiles: [], ghosts: [] };
}

describe("boardIdx", () => {
  it("maps slide-order position to the right flat index per direction", () => {
    expect([0, 1, 2, 3].map((p) => boardIdx("left", 1, p))).toEqual([4, 5, 6, 7]);
    expect([0, 1, 2, 3].map((p) => boardIdx("right", 1, p))).toEqual([7, 6, 5, 4]);
    expect([0, 1, 2, 3].map((p) => boardIdx("up", 2, p))).toEqual([2, 6, 10, 14]);
    expect([0, 1, 2, 3].map((p) => boardIdx("down", 2, p))).toEqual([14, 10, 6, 2]);
  });
});

describe("computeTransition", () => {
  it("places tiles instantly on first mount (prev === null)", () => {
    const board = Array(16).fill(0);
    board[0] = 2;
    board[5] = 4;
    const { tiles, ghosts, ledger } = computeTransition(null, mkState(board), null, nextId);
    expect(ghosts).toHaveLength(0);
    expect(tiles.map((t) => t.value).sort()).toEqual([2, 4]);
    expect(tiles.every((t) => !t.isNew && !t.isMerged)).toBe(true);
    expect([...ledger.keys()].sort((a, b) => a - b)).toEqual([0, 5]);
  });

  it("returns the previous render untouched on a no-op move (same board ref)", () => {
    const board = Array(16).fill(0);
    board[0] = 2;
    const prev = prevOf(board);
    prev.tiles = [{ id: 99, value: 2, row: 0, col: 0 }];
    const next = mkState(board); // same reference
    const out = computeTransition(prev, next, "left", nextId);
    expect(out.tiles).toBe(prev.tiles);
    expect(out.ledger).toBe(prev.ledger);
  });

  it("resets and flags the starting tiles when a New Game fires while mounted", () => {
    const board = Array(16).fill(0);
    board[3] = 2;
    board[12] = 2;
    const prev = prevOf([2, 0, 0, 0, ...Array(12).fill(0)]);
    const { tiles, ghosts } = computeTransition(
      prev,
      mkState(board, { moveCount: 0, newTiles: [3, 12] }),
      null,
      nextId,
    );
    expect(ghosts).toHaveLength(0);
    expect(tiles.filter((t) => t.isNew).map((t) => t.row * 4 + t.col).sort((a, b) => a - b)).toEqual([3, 12]);
  });

  it("merges only the first pair of a triple (skip-by-2), rest carries", () => {
    const prevBoard = [2, 2, 2, 0, ...Array(12).fill(0)];
    const nextBoard = [4, 2, 0, 0, 2, ...Array(11).fill(0)]; // [4,2] + spawn at idx 4
    const { tiles, ghosts } = computeTransition(
      prevOf(prevBoard),
      mkState(nextBoard, { newTiles: [4], mergedTiles: [0] }),
      "left",
      nextId,
    );
    // both source 2s become ghosts at the merge cell (0,0)
    expect(ghosts).toHaveLength(2);
    expect(ghosts.every((g) => g.row === 0 && g.col === 0 && g.value === 2)).toBe(true);
    // merged result at (0,0) value 4
    const merged = tiles.find((t) => t.isMerged);
    expect(merged).toMatchObject({ value: 4, row: 0, col: 0 });
    // third 2 carried to (0,1), keeping its id, not flagged
    const carried = tiles.find((t) => !t.isMerged && !t.isNew);
    expect(carried).toMatchObject({ value: 2, row: 0, col: 1 });
    // spawn flagged at (1,0)
    expect(tiles.find((t) => t.isNew)).toMatchObject({ value: 2, row: 1, col: 0 });
  });

  it("stays consistent with gameLogic across a real seeded game", () => {
    const { state: s0, rng } = initGame("0xabc123");
    let prev: TrackerPrev | null = null;
    let state = s0;
    let dir: Direction | null = null;

    const step = (t: ReturnType<typeof computeTransition>, st: GameState) => {
      // every non-zero board cell has exactly one live tile with the right value
      st.board.forEach((v, idx) => {
        const here = t.tiles.filter((x) => x.row * 4 + x.col === idx);
        if (v === 0) expect(here).toHaveLength(0);
        else {
          expect(here).toHaveLength(1);
          expect(here[0].value).toBe(v);
        }
      });
      // ledger mirrors the board exactly
      const keys = [...t.ledger.keys()].sort((a, b) => a - b);
      expect(keys).toEqual(st.board.map((v, i) => (v ? i : -1)).filter((i) => i >= 0));
      // two ghosts per merge, and merged-result flags land on mergedTiles
      expect(t.ghosts).toHaveLength(2 * st.mergedTiles.length);
      expect(t.tiles.filter((x) => x.isMerged).map((x) => x.row * 4 + x.col).sort((a, b) => a - b))
        .toEqual([...st.mergedTiles].sort((a, b) => a - b));
    };

    const first = computeTransition(null, state, null, nextId);
    step(first, state);
    prev = { board: state.board, ledger: first.ledger, tiles: first.tiles, ghosts: first.ghosts };

    const dirs: Direction[] = ["left", "up", "right", "down", "left", "left", "up", "right", "down", "up"];
    for (const d of dirs) {
      const nextState = applyMove(state, d, rng);
      dir = d;
      const out = computeTransition(prev, nextState, dir, nextId);
      if (nextState.board !== state.board) step(out, nextState);
      prev = { board: nextState.board, ledger: out.ledger, tiles: out.tiles, ghosts: out.ghosts };
      state = nextState;
      if (state.over || state.won) break;
    }
  });
});
