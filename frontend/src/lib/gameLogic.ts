export type Board = readonly number[];
export type Direction = "up" | "down" | "left" | "right";

export interface GameState {
  board: Board;
  score: number;
  highestTile: number;
  moveCount: number;
  over: boolean;
  won: boolean;
  /** Grid indices of tiles that just appeared (spawned this move). */
  newTiles: readonly number[];
  /** Grid indices of tiles that just merged. */
  mergedTiles: readonly number[];
  /** Consecutive merging-move streak in this game (resets on a non-merging move). */
  currentCombo: number;
  /** Highest combo streak reached in this game — reported to the contract. */
  maxCombo: number;
}

// Seeded PRNG — mulberry32. Uses lower 32 bits of the 256-bit seed hex.
function createRNG(seedHex: string): () => number {
  const lower32 = parseInt(seedHex.slice(-8), 16);
  let s = lower32 | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function emptyCells(board: Board): number[] {
  return board.reduce<number[]>((acc, v, i) => (v === 0 ? [...acc, i] : acc), []);
}

function spawnTile(board: number[], rng: () => number): number {
  const empties = emptyCells(board);
  if (empties.length === 0) return -1;
  const idx = empties[Math.floor(rng() * empties.length)];
  board[idx] = rng() < 0.9 ? 2 : 4;
  return idx;
}

// Slide and merge one "virtual row" leftward.
function slideRow(row: number[]): { out: number[]; score: number; mergedAt: number[] } {
  const filled = row.filter((v) => v !== 0);
  const out: number[] = [];
  const mergedAt: number[] = [];
  let score = 0;
  let i = 0;

  while (i < filled.length) {
    if (i + 1 < filled.length && filled[i] === filled[i + 1]) {
      const val = filled[i] * 2;
      out.push(val);
      mergedAt.push(out.length - 1);
      score += val;
      i += 2;
    } else {
      out.push(filled[i]);
      i++;
    }
  }

  while (out.length < 4) out.push(0);
  return { out, score, mergedAt };
}

// Extract a virtual row (4 values) sliding "leftward" in the given direction.
function extractLine(board: Board, dir: Direction, i: number): number[] {
  switch (dir) {
    case "left":  return [0, 1, 2, 3].map((j) => board[i * 4 + j]);
    case "right": return [3, 2, 1, 0].map((j) => board[i * 4 + j]);
    case "up":    return [0, 1, 2, 3].map((j) => board[j * 4 + i]);
    case "down":  return [3, 2, 1, 0].map((j) => board[j * 4 + i]);
  }
}

function writeLine(board: number[], dir: Direction, i: number, row: number[]): void {
  switch (dir) {
    case "left":  [0, 1, 2, 3].forEach((j, k) => { board[i * 4 + j] = row[k]; }); break;
    case "right": [3, 2, 1, 0].forEach((j, k) => { board[i * 4 + j] = row[k]; }); break;
    case "up":    [0, 1, 2, 3].forEach((j, k) => { board[j * 4 + i] = row[k]; }); break;
    case "down":  [3, 2, 1, 0].forEach((j, k) => { board[j * 4 + i] = row[k]; }); break;
  }
}

// Convert (direction, line, position-in-output) → board index.
function toBoardIdx(dir: Direction, line: number, pos: number): number {
  switch (dir) {
    case "left":  return line * 4 + pos;
    case "right": return line * 4 + (3 - pos);
    case "up":    return pos * 4 + line;
    case "down":  return (3 - pos) * 4 + line;
  }
}

function canMove(board: Board): boolean {
  for (let i = 0; i < 16; i++) {
    if (board[i] === 0) return true;
    if (i % 4 < 3 && board[i] === board[i + 1]) return true;
    if (i < 12 && board[i] === board[i + 4]) return true;
  }
  return false;
}

export function initGame(seedHex: string): { state: GameState; rng: () => number } {
  const rng = createRNG(seedHex);
  const board: number[] = new Array(16).fill(0);
  const newTiles: number[] = [];

  const a = spawnTile(board, rng);
  const b = spawnTile(board, rng);
  if (a >= 0) newTiles.push(a);
  if (b >= 0) newTiles.push(b);

  const highest = Math.max(...board);
  return {
    state: {
      board,
      score: 0,
      highestTile: highest,
      moveCount: 0,
      over: false,
      won: false,
      newTiles,
      mergedTiles: [],
      currentCombo: 0,
      maxCombo: 0,
    },
    rng,
  };
}

export function applyMove(
  state: GameState,
  dir: Direction,
  rng: () => number,
): GameState {
  if (state.over || state.won) return state;

  const b = [...state.board] as number[];
  let totalScore = 0;
  let changed = false;
  const mergedTiles: number[] = [];

  for (let i = 0; i < 4; i++) {
    const line = extractLine(b, dir, i);
    const { out, score, mergedAt } = slideRow(line);
    if (out.some((v, j) => v !== line[j])) changed = true;
    writeLine(b, dir, i, out);
    totalScore += score;
    mergedAt.forEach((pos) => mergedTiles.push(toBoardIdx(dir, i, pos)));
  }

  if (!changed) return { ...state, newTiles: [], mergedTiles: [] };

  const spawned = spawnTile(b, rng);
  const newTiles = spawned >= 0 ? [spawned] : [];

  const highestTile = Math.max(...b);
  const newScore = state.score + totalScore;
  const won = highestTile >= 2048;
  const over = !won && !canMove(b);

  const prevCombo  = (state.currentCombo ?? 0);
  const currentCombo = mergedTiles.length > 0 ? prevCombo + 1 : 0;
  const maxCombo = Math.max(state.maxCombo ?? 0, currentCombo);

  return {
    board: b,
    score: newScore,
    highestTile: Math.max(state.highestTile, highestTile),
    moveCount: state.moveCount + 1,
    over,
    won,
    newTiles,
    mergedTiles,
    currentCombo,
    maxCombo,
  };
}

/** Generate a cryptographically random 32-byte hex seed. */
export function generateSeed(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}
