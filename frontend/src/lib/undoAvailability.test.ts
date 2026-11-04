/**
 * Undo Step availability and purchasing. Undo needs BOTH keys: the operator switch
 * (NEXT_PUBLIC_UNDO_ENABLED) and a live contract that supports undo-at-submit (the upgraded
 * implementation, whose consumeUndo is restricted to the player). The app never calls consumeUndo.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { undoAvailability, undoUnavailableMessage, usableUndoCredits, type UndoAvailability } from "./undoAvailability";

const writeContractAsync = vi.fn(async (_req: { functionName: string; args?: unknown[] }) => "0xabc" as `0x${string}`);
let availability: UndoAvailability = { available: false, reason: "switched-off" };

vi.mock("wagmi", () => ({
  useReadContract: () => ({ data: undefined, error: null, status: "success", refetch: vi.fn() }),
  useReadContracts: () => ({ data: [], status: "success" }),
  useWriteContract: () => ({ writeContractAsync }),
  useWaitForTransactionReceipt: () => ({ isLoading: false }),
}));
vi.mock("../hooks/useContractData", () => ({
  useContractAddress: () => "0x00000000000000000000000000000000000000aa",
  useContractPublicClient: () => ({ waitForTransactionReceipt: async () => ({ status: "success", logs: [] }) }),
}));
vi.mock("../contexts/NoGasContext", () => ({ useNoGas: () => ({ triggerNoGas: vi.fn() }) }));
vi.mock("../hooks/useUndoAvailability", () => ({ useUndoAvailability: () => availability }));

import { useShop } from "../hooks/useShop";
import { useGame } from "../hooks/useGame";
import { useState } from "react";

const src = (p: string) => readFileSync(join(__dirname, p), "utf8");
function captureHook<T>(hook: () => T): T {
  let out!: T;
  const Probe = () => { out = hook(); return null; };
  renderToStaticMarkup(createElement(Probe));
  return out;
}
beforeEach(() => writeContractAsync.mockClear());

describe("Undo needs both keys", () => {
  it("available only with the switch on AND an upgraded (undo-at-submit) contract", () => {
    expect(undoAvailability({ enabled: true, mode: "at_submit" })).toEqual({ available: true, reason: null });
    expect(undoAvailability({ enabled: false, mode: "at_submit" })).toEqual({ available: false, reason: "switched-off" });
    expect(undoAvailability({ enabled: true, mode: "per_use" })).toEqual({ available: false, reason: "contract-not-upgraded" });
    expect(undoAvailability({ enabled: true, mode: "unknown" })).toEqual({ available: false, reason: "checking-contract" });
    expect(undoAvailability({ enabled: false, mode: "per_use" }).available).toBe(false);
  });

  it("an RPC failure reading the contract can only make Undo unavailable, never unsafe", async () => {
    const { undoModeFrom } = await import("./undoHistory");
    expect(undoModeFrom({ status: "error" })).toBe("per_use");
    expect(undoAvailability({ enabled: true, mode: undoModeFrom({ status: "error" }) }).available).toBe(false);
  });

  it("the switch is off unless a build turns it on", () => {
    expect(src("./constants.ts")).toContain('export const UNDO_ENABLED = process.env.NEXT_PUBLIC_UNDO_ENABLED === "true";');
  });

  it("with the switch off (the real default here), the board is never rewound and nothing is counted", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const seen: unknown[] = [];
    const steps: ((g: ReturnType<typeof useGame>) => unknown)[] = [
      (g) => { g.startNewGame("0x" + "ab".repeat(31) + "12345678"); },
      (g) => { for (const d of ["left", "up", "right", "down"] as const) g.handleMove(d); },
      (g) => g.state?.board.join(),
      (g) => g.undoLastMove({ countCredit: true }),
      (g) => [g.state?.board.join(), g.undosUsed],
    ];
    let i = 0;
    const Probe = () => {
      const g = useGame("0x00000000000000000000000000000000000000aa", true);
      const [, bump] = useState(0);
      if (i < steps.length) { const n = i++; seen.push(steps[n](g)); bump(n + 1); }
      return null;
    };
    renderToStaticMarkup(createElement(Probe));
    expect(seen[3]).toBe(false);
    expect(seen[4]).toEqual([seen[2], 0]);
  });

  it("explains every unavailable state, and says owned credits are kept", () => {
    expect(undoUnavailableMessage("contract-not-upgraded")).toContain("until the game contract upgrade");
    expect(undoUnavailableMessage("contract-not-upgraded")).toContain("Credits you already own are kept.");
    expect(undoUnavailableMessage("switched-off")).toContain("Credits you already own are kept.");
    expect(undoUnavailableMessage("checking-contract")).toMatch(/Checking/);
  });
});

describe("Undo balance", () => {
  it("is unknown (not 0) until the chain read returns", () => {
    expect(usableUndoCredits(undefined, 0)).toBeNull();
    expect(src("../hooks/useUndoCredits.ts")).toContain("return { undoCredits: data as bigint | undefined, refetchUndoCredits: refetch };");
  });
  it("is owned minus already used this game, never negative", () => {
    expect(usableUndoCredits(3n, 0)).toBe(3n);
    expect(usableUndoCredits(3n, 2)).toBe(1n);
    expect(usableUndoCredits(1n, 4)).toBe(0n);
    expect(usableUndoCredits(0n, 0)).toBe(0n);
  });
});

describe("Buying Undo credits", () => {
  it("is refused, with no wallet request, unless Undo is available", async () => {
    for (const reason of ["switched-off", "checking-contract", "contract-not-upgraded"] as const) {
      availability = { available: false, reason };
      const shop = captureHook(useShop);
      await shop.buyUndoMove(1);
    }
    expect(writeContractAsync).not.toHaveBeenCalled();
  });

  it("goes through buyUndoMove with the chosen quantity once Undo is available", async () => {
    availability = { available: true, reason: null };
    const shop = captureHook(useShop);
    await shop.buyUndoMove(3);
    expect(writeContractAsync).toHaveBeenCalledTimes(1);
    expect(writeContractAsync.mock.calls[0][0]).toMatchObject({ functionName: "buyUndoMove", args: [3n] });
  });

  it("other shop purchases (Streak Shield, 2x and 5x XP Boost, cosmetics) are unaffected either way", async () => {
    for (const a of [{ available: false, reason: "contract-not-upgraded" }, { available: true, reason: null }] as UndoAvailability[]) {
      availability = a;
      writeContractAsync.mockClear();
      const shop = captureHook(useShop);
      await shop.buyShield(); await shop.buyBoost(2); await shop.buyBoost(5); await shop.buyCosmetic(1);
      expect(writeContractAsync.mock.calls.map((c) => [c[0].functionName, c[0].args])).toEqual([
        ["buyStreakShield", undefined], ["buyXpBoost", [2]], ["buyXpBoost", [5]], ["buyCosmetic", [1n]],
      ]);
    }
  });
});

describe("The app never spends credits directly", () => {
  it("no source file calls consumeUndo; credits are spent only inside submitScoreWithUndos", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const hits = execSync(`grep -rlE "functionName: \\"consumeUndo\\"" ${join(__dirname, "..")} ${join(__dirname, "../../app")} || true`, { encoding: "utf8" })
      .split("\n").filter(Boolean).filter((f) => !f.includes(".test."));
    expect(hits).toEqual([]);
    // Comments may name consumeUndo (to say it's never called); calls and the old helper may not.
    for (const f of ["../hooks/useGameSession.ts", "../App.tsx", "../components/GameControls.tsx"]) {
      expect(src(f)).not.toMatch(/spendUndoCredit|"consumeUndo"|undoPending/);
    }
  });

  it("the Shop card, the Undo tip and How to Play all follow availability", () => {
    const shop = src("../components/Shop.tsx");
    expect(shop).toContain('button={undo.available ? button(prices.undo, "undo", { quantity: BigInt(undoQuantity) })');
    expect(shop).toContain(": undoUnavailableMessage(undo.reason)}");
    expect(shop).toContain('badge={countBadge(undoCredits, "credit", "credits")}'); // owned credits still shown
    expect(src("../hooks/useFeatureNotifications.ts")).toContain('if (undoAvailable && moveCount === 3 && !shownThisSession.has("undoStep")) {');
    expect(src("../../app/how-to-play/page.tsx")).toContain("undoEnabled={undo.available}");
  });

  it("How to Play describes Undo accurately when available and not at all when it isn't", async () => {
    const { GuideContent } = await import("../components/HowToPlayGuide");
    const prices = { shield: "500 G$", boost2x: "1,500 G$", boost5x: "4,000 G$", undo: "100 G$" };
    const on = renderToStaticMarkup(createElement(GuideContent, { prices, undoEnabled: true, bountyStatus: "ended" }));
    expect(on).toContain("Each undo uses one Undo credit from the Shop, charged when you submit the score");
    expect(on).toContain("Undo Step credits (100 G$ each)");
    const off = renderToStaticMarkup(createElement(GuideContent, { prices, undoEnabled: false, bountyStatus: "ended" }));
    expect(off).not.toMatch(/Undo/);
  });
});
