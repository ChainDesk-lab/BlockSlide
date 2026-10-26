/**
 * Gas preflight: the balance check is derived from the exact transaction's gas
 * limit and live fees. Numbers mirror Celo mainnet on 21 Oct 2026: base fee
 * 200 gwei, suggested tip 2.5 gwei, startSession 39k–73k gas, submitScore
 * 95k–435k gas (median 135k).
 */
import { describe, expect, it } from "vitest";
import {
  defaultRequiredWei,
  estimateFees,
  formatCelo,
  GasPlanRpcError,
  parseMinWei,
  planTransaction,
  type GasPlanClient,
} from "./gasPlan";
import { classifyTxError } from "./txErrors";
import { runExclusive } from "./runExclusive";

const GWEI = 10n ** 9n;
const CELO = 10n ** 18n;
const A = "0x00000000000000000000000000000000000000aa" as const;
const TX = { account: A, to: A, data: "0x" as const };

function client(over: Partial<{ base: bigint; tip: bigint; gasPrice: bigint; gas: bigint; balance: bigint; fail: string[] }> = {}): GasPlanClient {
  const o = { base: 200n * GWEI, tip: 2_500_000_000n, gasPrice: 202_500_000_000n, gas: 135_000n, balance: CELO, fail: [] as string[], ...over };
  const maybe = <T>(name: string, v: T) => (o.fail.includes(name) ? Promise.reject(new Error(`${name} failed`)) : Promise.resolve(v));
  return {
    getGasPrice: () => maybe("getGasPrice", o.gasPrice),
    getBlock: () => maybe("getBlock", { baseFeePerGas: o.base }),
    estimateMaxPriorityFeePerGas: () => maybe("estimateMaxPriorityFeePerGas", o.tip),
    estimateGas: () => maybe("estimateGas", o.gas),
    getBalance: () => maybe("getBalance", o.balance),
  };
}

describe("planTransaction", () => {
  it("requires gas limit × fee cap, from the live estimate and live base fee", async () => {
    const p = await planTransaction(client(), { ...TX, fallbackGas: 500_000n, legacy: false });
    expect(p.gas).toBe(185_000n); // 135k + max(20%, 50k)
    expect(p.fees).toEqual({ type: "eip1559", maxFeePerGas: 242_500_000_000n, maxPriorityFeePerGas: 2_500_000_000n });
    expect(p.requiredWei).toBe(185_000n * 242_500_000_000n); // ≈ 0.0449 CELO
    expect(p.gasEstimated).toBe(true);
  });

  it("accepts a 0.05 CELO wallet for a typical score submission (the old fixed caps demanded 0.25 CELO)", async () => {
    const p = await planTransaction(client({ balance: CELO / 20n }), { ...TX, fallbackGas: 500_000n, legacy: false });
    expect(p.sufficient).toBe(true);
    expect(500_000n * 500n * GWEI).toBe(CELO / 4n); // what the fixed limit × fixed cap required
  });

  it("rejects a wallet that the old 0.001 CELO threshold would have passed", async () => {
    const p = await planTransaction(client({ balance: 2n * 10n ** 15n }), { ...TX, fallbackGas: 500_000n, legacy: false });
    expect(p.sufficient).toBe(false); // 0.002 CELO buys ~8k gas at 242.5 gwei
    expect(p.requiredWei).toBeGreaterThan(10n ** 15n);
  });

  it("flags the largest observed submission (435k gas) as needing more than a 0.05 CELO wallet holds", async () => {
    const p = await planTransaction(client({ gas: 435_296n, balance: CELO / 20n }), { ...TX, fallbackGas: 500_000n, legacy: false });
    expect(p.sufficient).toBe(false);
    expect(p.gas).toBe(522_355n); // large estimates get the 20%
    expect(formatCelo(p.requiredWei)).toBe("0.1267");
  });

  it("gives small estimates at least 50k gas of headroom (one storage write costs ~22k)", async () => {
    const p = await planTransaction(client({ gas: 94_686n }), { ...TX, fallbackGas: 500_000n, legacy: false });
    expect(p.gas).toBe(144_686n);
  });

  it("doesn't trust a lagging node's old base fee when eth_gasPrice shows a higher one", async () => {
    const p = await planTransaction(client({ base: 100n * GWEI, gasPrice: 302_500_000_000n }), { ...TX, fallbackGas: 1n, legacy: false });
    // base taken as 302.5 - 2.5 = 300 gwei, not the stale 100
    expect(p.fees.type === "eip1559" && p.fees.maxFeePerGas).toBe(362_500_000_000n);
  });

  it("scales with the base fee instead of a fixed cap", async () => {
    const p = await planTransaction(client({ base: 1_000n * GWEI }), { ...TX, fallbackGas: 500_000n, legacy: false });
    expect(p.fees.type === "eip1559" && p.fees.maxFeePerGas).toBe(1_202_500_000_000n); // above the old 500 gwei cap
  });

  it("uses a legacy gasPrice (live + 20%) for Magic wallets", async () => {
    const p = await planTransaction(client(), { ...TX, fallbackGas: 200_000n, legacy: true });
    expect(p.fees).toEqual({ type: "legacy", gasPrice: 243_000_000_000n });
  });

  it("falls back to the caller's gas limit when estimation fails", async () => {
    const p = await planTransaction(client({ fail: ["estimateGas"] }), { ...TX, fallbackGas: 200_000n, legacy: false });
    expect(p).toMatchObject({ gas: 200_000n, gasEstimated: false });
  });

  it("uses a fallback tip, not a failure, when no tip can be suggested", async () => {
    const fees = await estimateFees(client({ fail: ["estimateMaxPriorityFeePerGas"] }), false);
    expect(fees).toEqual({ type: "eip1559", maxFeePerGas: 242_500_000_000n, maxPriorityFeePerGas: 2_500_000_000n });
  });

  it("reports unreadable fees as an RPC problem, not as insufficient funds", async () => {
    const err = await planTransaction(client({ fail: ["getBlock"] }), { ...TX, fallbackGas: 1n, legacy: false }).catch((e) => e);
    expect(err).toBeInstanceOf(GasPlanRpcError);
    expect(classifyTxError(err)).toBe("rpc_unavailable");
  });

  it("reports an unreadable balance as an RPC problem", async () => {
    const err = await planTransaction(client({ fail: ["getBalance"] }), { ...TX, fallbackGas: 1n, legacy: false }).catch((e) => e);
    expect(err).toBeInstanceOf(GasPlanRpcError);
  });
});

describe("gas-faucet requirement helpers", () => {
  it("parses a caller-supplied minWei and rejects junk or absurd values", () => {
    expect(parseMinWei("39285000000000000")).toBe(39_285_000_000_000_000n);
    for (const bad of [null, "", "-1", "0", "1e18", "abc", "11000000000000000000"]) expect(parseMinWei(bad as any)).toBeNull();
  });
  it("defaults to a 250k-gas budget at the live gas price + 20%", () => {
    expect(defaultRequiredWei(202_500_000_000n)).toBe(250_000n * 243_000_000_000n); // 0.06075 CELO
  });
  it("formats CELO rounded up, so a shortfall is never understated", () => {
    expect(formatCelo(1n)).toBe("0.0001");
    expect(formatCelo(CELO / 20n)).toBe("0.0500");
  });
});

describe("runExclusive (one submission at a time)", () => {
  it("ignores a second call while the first is still running", async () => {
    const lock = { current: false };
    let runs = 0;
    let release!: () => void;
    const work = () => new Promise<void>((r) => { runs++; release = r; });
    const first = runExclusive(lock, work);
    const second = await runExclusive(lock, work);
    expect(second).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(runs).toBe(1);
  });

  it("releases the lock after a failure so the player can try again", async () => {
    const lock = { current: false };
    const busy: boolean[] = [];
    await expect(runExclusive(lock, async () => { throw new Error("boom"); }, (b) => busy.push(b))).rejects.toThrow("boom");
    expect(lock.current).toBe(false);
    expect(busy).toEqual([true, false]);
    expect(await runExclusive(lock, async () => {})).toBe(true);
  });
});
