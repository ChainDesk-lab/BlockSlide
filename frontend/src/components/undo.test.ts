/**
 * Undo Step: the button is on the game screen when the player can use it,
 * spends the credit through the correct contract call, and the board's undo
 * restores the exact pre-move state including the tile RNG.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData } from "viem";
import GameControls from "./GameControls";
import { AuthContext } from "../auth/AuthContext";
import { UNDO_ENABLED } from "../lib/constants";
import { GAME2048_MERGED_ABI } from "../lib/abiMerged";
import { initGame, type Direction, type GameState } from "../lib/gameLogic";
import { canUndoFrom, countedRng, moveWithUndo, undoTo } from "../lib/undoHistory";

const SRC = join(__dirname, "..");
const SEED = "0x" + "ab".repeat(31) + "12345678";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [p] : [];
  });
}

function controls(over: Record<string, unknown> = {}) {
  const auth = { isConnected: true, address: "0x0000000000000000000000000000000000000001" } as any;
  return renderToStaticMarkup(
    createElement(
      AuthContext.Provider,
      { value: auth },
      createElement(GameControls, {
        state: { over: false, won: false } as any,
        phase: "active",
        isPending: false,
        isWrongChain: false,
        identityStatus: "verified" as any,
        canSubmitScore: true,
        onNewGame: () => {},
        onSubmit: () => {},
        undoCredits: 2n,
        canUndo: true,
        onUndo: vi.fn(),
        undoPending: false,
        ...over,
      } as any),
    ),
  );
}
const undoButton = (html: string) => html.match(/<button[^>]*undo-btn[^>]*>.*?<\/button>/)?.[0] ?? null;

describe("Undo button on the game screen", () => {
  it("is enabled", () => expect(UNDO_ENABLED).toBe(true));

  it("shows, enabled, with the credit count during play", () => {
    const b = undoButton(controls());
    expect(b).toContain("Undo (2)");
    expect(b).not.toMatch(/disabled/);
  });

  it("is still offered after a game over, to take back the losing move", () => {
    expect(undoButton(controls({ state: { over: true, won: false } }))).not.toMatch(/disabled/);
  });

  it("is disabled with no credits, or with no move to take back", () => {
    expect(undoButton(controls({ undoCredits: 0n }))).toMatch(/disabled/);
    expect(undoButton(controls({ canUndo: false }))).toMatch(/disabled/);
    expect(undoButton(controls({ undoPending: true }))).toMatch(/Undoing/);
  });

  it("is not offered after a win, or outside active play", () => {
    expect(undoButton(controls({ state: { over: false, won: true } }))).toBeNull();
    expect(undoButton(controls({ phase: "submitting" }))).toBeNull();
    expect(undoButton(controls({ phase: "idle" }))).toBeNull();
  });
});

describe("spending a credit uses the deployed signature", () => {
  it("the old no-argument call cannot even be encoded", () => {
    expect(() =>
      encodeFunctionData({ abi: GAME2048_MERGED_ABI as any, functionName: "consumeUndo", args: [] }),
    ).toThrow();
    const data = encodeFunctionData({
      abi: GAME2048_MERGED_ABI,
      functionName: "consumeUndo",
      args: ["0x000000000000000000000000000000000000dEaD"],
    });
    expect(data.slice(0, 10)).toBe("0xe4809329"); // consumeUndo(address)
  });

  it("is called from exactly one place, with the player's own address", () => {
    const callers = sourceFiles(SRC).filter((f) => /functionName:\s*["']consumeUndo["']/.test(readFileSync(f, "utf8")));
    expect(callers.map((f) => f.replace(SRC, ""))).toEqual(["/hooks/useGameSession.ts"]);
    const src = readFileSync(join(SRC, "hooks/useGameSession.ts"), "utf8");
    expect(src).toMatch(/const args = \[address\] as const;[\s\S]*functionName: "consumeUndo",\s*args,/);
    expect(src).not.toMatch(/functionName: "consumeUndo",\s*args: \[\]/);
  });

  it("reverts the move only after the credit was spent", () => {
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    expect(app).toMatch(/const spent = await spendUndoCredit\(\);\s*if \(spent\) \{\s*undoLastMove\(\);/);
  });
});

describe("board undo (lib/undoHistory)", () => {
  /** Play until a move changes the board; returns the state after it. */
  function play(state: GameState, counted: ReturnType<typeof countedRng>, dirs: Direction[]) {
    let s = state;
    let snap = null;
    for (const d of dirs) {
      const r = moveWithUndo(s, d, counted);
      s = r.next;
      snap = r.snapshot ?? snap;
    }
    return { s, snap };
  }

  it("restores board, score, move count and combo exactly", () => {
    const counted = countedRng(SEED);
    const start = initGame(SEED).state;
    const { s: mid } = play(start, counted, ["left", "up", "right"]);
    const { next, snapshot } = moveWithUndo(mid, "down", counted);
    expect(snapshot).not.toBeNull();
    const { state: back } = undoTo(SEED, snapshot!);
    expect(back.board).toEqual(mid.board);
    expect(back).toMatchObject({ score: mid.score, moveCount: mid.moveCount, maxCombo: mid.maxCombo, currentCombo: mid.currentCombo });
    expect(next.moveCount).toBe(mid.moveCount + 1);
  });

  it("can't be used to re-roll a tile: an undone move replays identically", () => {
    // Path A: left, up, right, down — straight through.
    const a = countedRng(SEED);
    const { s: endA } = play(initGame(SEED).state, a, ["left", "up", "right", "down"]);

    // Path B: left, up, right, UNDO, right, down.
    const b = countedRng(SEED);
    const { s: midB, snap } = play(initGame(SEED).state, b, ["left", "up", "right"]);
    expect(midB.moveCount).toBe(3);
    const { state: back, counted: rewound } = undoTo(SEED, snap!);
    const { s: endB } = play(back, rewound, ["right", "down"]);

    expect(endB.board).toEqual(endA.board);
    expect(endB.score).toBe(endA.score);
    expect(rewound.calls()).toBe(a.calls());
  });

  it("records no snapshot for a move that changes nothing", () => {
    const counted = countedRng(SEED);
    const start = initGame(SEED).state;
    const blocked: GameState = { ...start, board: [2, 4, 8, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    expect(moveWithUndo(blocked, "up", counted).snapshot).toBeNull();
    expect(counted.calls()).toBe(0); // and no RNG draw was spent
  });

  it("allows undo after a game over but not after a win", () => {
    const snap = { state: initGame(SEED).state, rngCalls: 0 };
    expect(canUndoFrom({ ...snap.state, over: true }, snap)).toBe(true);
    expect(canUndoFrom({ ...snap.state, won: true }, snap)).toBe(false);
    expect(canUndoFrom(snap.state, null)).toBe(false);
  });
});

describe("undo at submit (after the contract upgrade)", () => {
  it("detects the mode from supportsUndoAtSubmit()", async () => {
    const { undoModeFrom } = await import("../lib/undoHistory");
    expect(undoModeFrom({ status: "success", data: true })).toBe("at_submit");
    expect(undoModeFrom({ status: "error" })).toBe("per_use"); // current contract: the call reverts
    expect(undoModeFrom({ status: "pending" })).toBe("unknown");
  });

  it("shows credits left = owned minus used this game, never negative", async () => {
    const { undosAvailable } = await import("../lib/undoHistory");
    expect(undosAvailable(3n, 1, "at_submit")).toBe(2n);
    expect(undosAvailable(1n, 4, "at_submit")).toBe(0n);
    expect(undosAvailable(3n, 1, "per_use")).toBe(3n); // per-use credits drop on-chain each time
  });

  it("is instant in at-submit mode: no transaction, just the local undo counted against credits", () => {
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    const instant = app.slice(app.indexOf('if (undoMode === "at_submit") {'), app.indexOf("const spent = await spendUndoCredit();"));
    expect(instant).toMatch(/undoLastMove\(\{ countCredit: true \}\)/);
    expect(instant).not.toMatch(/spendUndoCredit|writeContract|signAndBroadcast/);
    expect(app).toMatch(/if \(undosLeft <= 0n\) return;/);
  });

  it("sends the game's undo count with the score only when the contract supports it", () => {
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    expect(app).toMatch(/submitScore\(state, seed as `0x\$\{string\}`, undoMode === "at_submit" \? undosUsed : 0\)/);
    const session = readFileSync(join(SRC, "hooks/useGameSession.ts"), "utf8");
    expect(session).toMatch(/const withUndos = undosUsed > 0;/);
    expect(session).toMatch(/functionName: "submitScoreWithUndos", args: undoArgs/);
  });

  it("encodes submitScoreWithUndos to the compiled selector", () => {
    const data = encodeFunctionData({
      abi: GAME2048_MERGED_ABI,
      functionName: "submitScoreWithUndos",
      args: [400n, 128, 50n, ("0x" + "11".repeat(32)) as `0x${string}`, 0n, 2n],
    });
    expect(data.length).toBe(2 + 8 + 64 * 6);
  });

  it("counts an undo used and keeps the count through a reload (persisted with the game)", () => {
    const g = readFileSync(join(SRC, "hooks/useGame.ts"), "utf8");
    expect(g).toMatch(/if \(options\?\.countCredit\) setUndosUsed\(\(n\) => n \+ 1\);/);
    expect(g).toMatch(/const data: PersistedGame = \{ seed, state, undosUsed \};/);
    expect(g).toMatch(/setUndosUsed\(saved\.undosUsed \?\? 0\);/);
  });
});
