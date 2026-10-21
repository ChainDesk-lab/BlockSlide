/**
 * Regression: Undo is disabled and nothing in the UI can reach the contract's
 * consumeUndo. The old button called consumeUndo() with no argument — a
 * selector the deployed contract doesn't have — and never reverted the move.
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

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [p] : [];
  });
}

function renderControls(onUndo: () => void) {
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
        undoCredits: 3n,
        onUndo,
        undoPending: false,
      }),
    ),
  );
}

describe("Undo is disabled", () => {
  it("is switched off by its flag", () => {
    expect(UNDO_ENABLED).toBe(false);
  });

  it("renders no Undo control even when credits and a handler are supplied", () => {
    const onUndo = vi.fn();
    const html = renderControls(onUndo);
    expect(html).not.toMatch(/undo/i);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("has no source file that calls consumeUndo", () => {
    const callers = sourceFiles(SRC).filter((f) =>
      /functionName:\s*["']consumeUndo["']/.test(readFileSync(f, "utf8")),
    );
    expect(callers).toEqual([]);
  });

  it("does not wire an Undo handler into the game controls", () => {
    // Code only: comments explaining why Undo is off may name the method.
    const app = readFileSync(join(SRC, "App.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(app).not.toMatch(/onUndo=/);
    expect(app).not.toMatch(/consumeUndo/);
  });

  it("uses the compiled consumeUndo(address) signature, so the old no-argument call cannot even be encoded", () => {
    expect(() =>
      encodeFunctionData({ abi: GAME2048_MERGED_ABI as any, functionName: "consumeUndo", args: [] }),
    ).toThrow();
    const data = encodeFunctionData({
      abi: GAME2048_MERGED_ABI,
      functionName: "consumeUndo",
      args: ["0x000000000000000000000000000000000000dEaD"],
    });
    // keccak256("consumeUndo(address)")[0..4]
    expect(data.slice(0, 10)).toBe("0xe4809329");
  });
});
