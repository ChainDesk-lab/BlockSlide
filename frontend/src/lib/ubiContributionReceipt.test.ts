/**
 * A failed or reverted purchase is never reported as a UBI contribution.
 *
 * On-chain, a reverted transaction keeps no logs, so its receipt can't carry a
 * UbiContribution event. The app doesn't rely on that alone: the purchase
 * confirmation counts a contribution only from a receipt whose status is
 * "success", and these tests pin that rule.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { GAME2048_UBI_ABI } from "./abiUbi";
import { confirmedContributionTotal } from "./ubiContribution";

const GAME = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6" as const;
const UBI = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1" as const;
const BUYER = "0x00000000000000000000000000000000000000aa" as const;
const OTHER = "0x00000000000000000000000000000000000000bb" as const;
const G = 10n ** 18n;

function contributionLog(buyer: `0x${string}`, amountPaid: bigint, contribution: bigint) {
  const topics = encodeEventTopics({ abi: GAME2048_UBI_ABI, eventName: "UbiContribution", args: { buyer, item: 0, recipient: UBI } });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [0n, 1n, amountPaid, contribution],
  );
  return { address: GAME, topics: topics as `0x${string}`[], data };
}

describe("confirmedContributionTotal: only a successful purchase reports a contribution", () => {
  it("a successful purchase reports the contribution its receipt contains", () => {
    const receipt = { status: "success", logs: [contributionLog(BUYER, 500n * G, 25n * G)] };
    expect(confirmedContributionTotal(receipt, GAME, BUYER)).toBe(25n * G);
  });

  it("a reverted purchase reports nothing, even if a contribution log is attached", () => {
    const receipt = { status: "reverted", logs: [contributionLog(BUYER, 500n * G, 25n * G)] };
    expect(confirmedContributionTotal(receipt, GAME, BUYER)).toBe(0n);
  });

  it("any status other than success reports nothing", () => {
    for (const status of ["", "pending", "failed", "0x0", "Success"]) {
      expect(confirmedContributionTotal({ status, logs: [contributionLog(BUYER, 100n * G, 5n * G)] }, GAME, BUYER), status).toBe(0n);
    }
  });

  it("a successful transaction with several purchases reports their sum, and only this buyer's", () => {
    const receipt = {
      status: "success",
      logs: [contributionLog(BUYER, 500n * G, 25n * G), contributionLog(OTHER, 1500n * G, 75n * G), contributionLog(BUYER, 100n * G, 5n * G)],
    };
    expect(confirmedContributionTotal(receipt, GAME, BUYER)).toBe(30n * G);
  });

  it("a successful purchase on the implementation without UBI reports nothing", () => {
    expect(confirmedContributionTotal({ status: "success", logs: [] }, GAME, BUYER)).toBe(0n);
  });
});

describe("the Shop's purchase confirmation uses that rule", () => {
  const src = readFileSync(join(__dirname, "../hooks/useShop.ts"), "utf8");

  it("reads contributions only through confirmedContributionTotal, never straight from the logs", () => {
    expect(src).toMatch(/confirmedContributionTotal\(receipt,/);
    expect(src).not.toMatch(/contributionsFromReceipt\(/);
  });

  it("stops on a reverted receipt before any contribution is read", () => {
    const reverted = src.indexOf('receipt.status === "reverted"');
    const read = src.indexOf("confirmedContributionTotal(receipt,");
    expect(reverted).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(reverted);
  });
});
