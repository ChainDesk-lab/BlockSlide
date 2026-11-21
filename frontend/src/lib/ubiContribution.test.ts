import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { GAME2048_UBI_ABI } from "./abiUbi";
import { contributionsFromReceipt, formatBps, ubiContributionFor } from "./ubiContribution";

const GAME = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6" as const;
const UBI = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1" as const;
const BUYER = "0x00000000000000000000000000000000000000aa" as const;
const G = 10n ** 18n;

function contributionLog(buyer: `0x${string}`, amountPaid: bigint, contribution: bigint, address: `0x${string}` = GAME) {
  const topics = encodeEventTopics({
    abi: GAME2048_UBI_ABI,
    eventName: "UbiContribution",
    args: { buyer, item: 0, recipient: UBI },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [0n, 1n, amountPaid, contribution],
  );
  return { address, topics: topics as `0x${string}`[], data };
}

describe("ubiContributionFor (same formula as the contract)", () => {
  it("is floor(amount × bps / 10,000)", () => {
    expect(ubiContributionFor(500n * G, 500n)).toBe(25n * G);
    expect(ubiContributionFor(25n * G, 500n)).toBe(125n * 10n ** 16n);
    expect(ubiContributionFor(19n, 500n)).toBe(0n);
    expect(ubiContributionFor(20n, 500n)).toBe(1n);
    expect(ubiContributionFor(39n, 500n)).toBe(1n);
  });
  it("formats the rate from basis points", () => {
    expect(formatBps(500n)).toBe("5%");
    expect(formatBps(250n)).toBe("2.5%");
    expect(formatBps(1000n)).toBe("10%");
  });
});

describe("contributionsFromReceipt", () => {
  it("reads the confirmed contribution from the purchase receipt", () => {
    const logs = [contributionLog(BUYER, 500n * G, 25n * G)];
    expect(contributionsFromReceipt(logs, GAME, BUYER)).toEqual([
      { contribution: 25n * G, amountPaid: 500n * G, recipient: UBI },
    ]);
  });
  it("ignores other contracts, other buyers and unrelated logs", () => {
    const logs = [
      contributionLog(BUYER, 500n * G, 25n * G, "0x0000000000000000000000000000000000000bad"),
      contributionLog("0x00000000000000000000000000000000000000bb", 500n * G, 25n * G),
      { address: GAME, topics: ["0x" + "11".repeat(32)] as `0x${string}`[], data: "0x" as const },
    ];
    expect(contributionsFromReceipt(logs as any, GAME, BUYER)).toEqual([]);
  });
  it("claims nothing for a receipt without the event (pre-upgrade contract)", () => {
    expect(contributionsFromReceipt([], GAME, BUYER)).toEqual([]);
  });
});

describe("contract policy guard: every paid item contributes", () => {
  const sol = readFileSync(join(__dirname, "../../../contracts/Game2048.sol"), "utf8");

  it("every buy* function pays through _collectPayment", () => {
    const buys = [...sol.matchAll(/function (buy\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n    \}/g)];
    expect(buys.map((m) => m[1]).sort()).toEqual(["buyCosmetic", "buyStreakShield", "buyUndoMove", "buyXpBoost"]);
    for (const [, name, body] of buys) {
      expect(body, name).toMatch(/_collectPayment\(/);
      expect(body, name).not.toMatch(/transferFrom\(/);
    }
  });

  it("takes G$ from a caller only in _collectPayment (and the owner's fundTreasury)", () => {
    const pulls = [...sol.matchAll(/function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n    \}/g)]
      .filter(([, , body]) => /[tT]ransferFrom\(\s*msg\.sender/.test(body))
      .map(([, name]) => name);
    expect(pulls.sort()).toEqual(["_collectPayment", "fundTreasury"]);
  });

  it("uses 500 bps and a 10% cap", () => {
    expect(sol).toMatch(/UBI_CONTRIBUTION_BPS\s*=\s*500;/);
    expect(sol).toMatch(/MAX_UBI_CONTRIBUTION_BPS\s*=\s*1_000;/);
  });
});
