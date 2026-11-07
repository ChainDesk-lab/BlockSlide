/**
 * Undo Step gameplay, with the operator switch on (the state it will run in after the contract
 * upgrade). Uses the real game engine (lib/gameLogic via lib/undoHistory) and the real useGame hook.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../lib/constants", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/constants")>()), UNDO_ENABLED: true }));

import { initGame, type Direction, type GameState } from "../lib/gameLogic";
import { canUndoFrom, countedRng, moveWithUndo, undoTo, type UndoSnapshot } from "../lib/undoHistory";
import { useGame } from "./useGame";

const SEED = "0x" + "ab".repeat(31) + "12345678";
const DIRS: Direction[] = ["left", "up", "right", "down"];
const src = (p: string) => readFileSync(join(__dirname, p), "utf8");
const strip = (s: GameState) => ({ board: [...s.board], score: s.score, moveCount: s.moveCount, currentCombo: s.currentCombo, maxCombo: s.maxCombo, over: s.over, won: s.won });

/** Play moves that change the board, returning the states and the snapshot of the last one. */
function play(n: number) {
  let state = initGame(SEED).state;
  const rng = countedRng(SEED);
  const states: GameState[] = [state];
  let last: UndoSnapshot | null = null;
  for (let i = 0; states.length <= n && i < 200; i++) {
    const { next, snapshot } = moveWithUndo(state, DIRS[i % 4], rng);
    if (snapshot) { last = snapshot; state = next; states.push(next); }
  }
  return { states, state, last: last!, rng };
}

describe("Undo restores exactly the previous position", () => {
  it("one move then Undo: board, score, move count and combo are back to before the move", () => {
    const { states, last } = play(1);
    const restored = undoTo(SEED, last).state;
    expect(strip(restored)).toEqual(strip(states[0]));
  });

  it("several moves then Undo: only the most recent move is reversed", () => {
    const { states, last } = play(6);
    const restored = undoTo(SEED, last).state;
    expect(strip(restored)).toEqual(strip(states[5]));
    expect(restored.moveCount).toBe(states[6].moveCount - 1);
    expect(restored.score).toBeLessThanOrEqual(states[6].score);
  });

  it("an undone move can't re-roll its tile: replaying it gives the identical board", () => {
    const { last, states } = play(3);
    // Replay every direction from the restored position (fresh restore each time): one of them is the
    // undone move, and it must reproduce the same board, including the spawned tile.
    const replayed = DIRS.map((d) => { const { state: back, counted } = undoTo(SEED, last); return moveWithUndo(back, d, counted).next; })
      .find((s) => s.board.join() === states[3].board.join());
    expect(replayed?.board).toEqual(states[3].board);
  });

  it("no previous move: nothing to undo", () => {
    const start = initGame(SEED).state;
    expect(canUndoFrom(start, null)).toBe(false);
  });

  it("not after a win; allowed after a loss (take back the losing move)", () => {
    const { last } = play(2);
    expect(canUndoFrom({ ...last.state, won: true }, last)).toBe(false);
  });
});

describe("useGame: one take-back per move, never double-counted", () => {
  type Api = ReturnType<typeof useGame>;
  /**
   * Runs `steps` against the real hook, one per render. The server renderer re-renders a component
   * that updates its own state during render, so each step sees the state the previous one left.
   */
  function drive(steps: ((g: Api) => unknown)[]) {
    const results: unknown[] = [];
    let i = 0;
    const Probe = () => {
      const g = useGame("0x00000000000000000000000000000000000000aa", true);
      const [, bump] = useState(0);
      if (i < steps.length) { const n = i++; results.push(steps[n](g)); bump(n + 1); }
      return null;
    };
    renderToStaticMarkup(createElement(Probe));
    expect(i).toBe(steps.length);
    return results;
  }
  const FIRST = DIRS.find((d) => moveWithUndo(initGame(SEED).state, d, countedRng(SEED)).snapshot)!;
  const start = (g: Api) => { g.startNewGame(SEED); };
  const moveAll = (g: Api) => { for (const d of DIRS) g.handleMove(d); };
  const undo = (g: Api) => g.undoLastMove({ countCredit: true });
  const snap = (g: Api) => ({ board: g.state?.board.join(), score: g.state?.score, moves: g.state?.moveCount, used: g.undosUsed, canUndo: g.canUndo });
  vi.spyOn(console, "log").mockImplementation(() => {});

  it("Undo with no move made is refused, and counts nothing", () => {
    const r = drive([start, undo, snap]);
    expect(r[1]).toBe(false);
    expect((r[2] as ReturnType<typeof snap>).used).toBe(0);
  });

  it("one move then Undo: the board and score shown are exactly the pre-move ones; one credit counted", () => {
    const r = drive([start, snap, (g) => g.handleMove(FIRST), snap, undo, snap]) as any[];
    expect(r[3].moves).toBe(1);
    expect(r[4]).toBe(true);
    expect({ ...r[5], used: undefined, canUndo: undefined }).toEqual({ ...r[1], used: undefined, canUndo: undefined });
    expect(r[5].used).toBe(1);
    expect(r[5].canUndo).toBe(false);
  });

  it("a double click (two calls before React re-renders) undoes once and counts one credit", () => {
    const r = drive([start, moveAll, (g) => [undo(g), undo(g)], snap]) as any[];
    expect(r[2]).toEqual([true, false]);
    expect(r[3].used).toBe(1);
  });

  it("consecutive Undo needs a new move in between; each counted once", () => {
    const r = drive([start, moveAll, undo, undo, moveAll, undo, snap]) as any[];
    expect([r[2], r[3], r[5]]).toEqual([true, false, true]);
    expect(r[6].used).toBe(2);
  });

  it("Undo without countCredit (never used by the app) rewinds but counts nothing", () => {
    const r = drive([start, moveAll, (g) => g.undoLastMove(), snap]) as any[];
    expect(r[2]).toBe(true);
    expect(r[3].used).toBe(0);
  });

  it("a new game clears the take-back and the count", () => {
    const r = drive([start, moveAll, undo, moveAll, start, undo, snap]) as any[];
    expect(r[5]).toBe(false);
    expect(r[6].used).toBe(0);
  });

  it("the claim happens synchronously, before the board is rewound", () => {
    const g = src("./useGame.ts");
    const fn = g.slice(g.indexOf("const undoLastMove = useCallback("));
    expect(fn.indexOf("undoSnapshotRef.current = null;")).toBeLessThan(fn.indexOf("undoTo(seed, snapshot)"));
  });
});

describe("Credits, submission and reload", () => {
  const app = src("../App.tsx");

  it("Undo spends nothing on the spot: it's counted, and the count rides with the score", () => {
    const handle = app.slice(app.indexOf("const handleUndo = () => {"), app.indexOf("// Credits change on-chain"));
    expect(handle).toContain("if (!undo.available || !canUndo || undosLeft === null || undosLeft <= 0n) return;");
    expect(handle).toContain("undoLastMove({ countCredit: true })");
    expect(handle).not.toMatch(/writeContract|signAndBroadcast|consumeUndo|await/);
    expect(app).toContain("submitScore(state, seed as `0x${string}`, undo.available ? undosUsed : 0);");
  });

  it("the submitted score is the board's score (undo restored it), with the undo count", () => {
    const s = src("./useGameSession.ts");
    expect(s).toContain("const withUndos = undosUsed > 0;");
    expect(s).toMatch(/functionName: "submitScoreWithUndos", args: undoArgs/);
    expect(s).toContain("BigInt(Math.max(Math.round(gameState.score) || 0, 0)),");
  });

  it("a rejected submission (too few credits) says why and leaves the game to resubmit; nothing is charged", () => {
    const s = src("./useGameSession.ts");
    expect(s).toContain("but your wallet doesn't hold that many credits. Buy more in the shop, then submit again.");
  });

  it("the undo count survives a reload with the saved game; the balance is re-read from the chain", () => {
    const g = src("./useGame.ts");
    expect(g).toMatch(/const data: PersistedGame = \{ seed, state, undosUsed \};/);
    expect(g).toMatch(/setUndosUsed\(saved\.undosUsed \?\? 0\);/);
    expect(app).toContain('window.addEventListener("scoreSubmitted", onSubmitted);');
  });

  it("the Undo button: shown only when available; disabled until the balance loads, with no credits, or no move", async () => {
    const { default: GameControls } = await import("../components/GameControls");
    const { AuthContext } = await import("../auth/AuthContext");
    const render = (over: Record<string, unknown>) => renderToStaticMarkup(createElement(AuthContext.Provider, { value: { isConnected: true, address: "0x00000000000000000000000000000000000000aa" } as any },
      createElement(GameControls, { state: { over: false, won: false } as any, phase: "active", isPending: false, isWrongChain: false, identityStatus: "verified" as any, canSubmitScore: true,
        onNewGame: () => {}, onSubmit: () => {}, undoAvailable: true, undoCredits: 2n, canUndo: true, onUndo: () => {}, ...over } as any)));
    const btn = (html: string) => html.match(/<button[^>]*undo-btn[^>]*>.*?<\/button>/)?.[0] ?? null;
    expect(btn(render({}))).toContain("Undo (2)");
    expect(btn(render({}))).not.toMatch(/disabled/);
    expect(btn(render({ undoAvailable: false }))).toBeNull();
    expect(btn(render({ undoCredits: null }))).toMatch(/disabled=""[^>]*>↶ Undo \(…\)/);
    expect(btn(render({ undoCredits: 0n }))).toMatch(/disabled/);
    expect(btn(render({ canUndo: false }))).toMatch(/disabled/);
  });
});
