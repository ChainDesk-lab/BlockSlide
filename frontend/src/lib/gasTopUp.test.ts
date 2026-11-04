/**
 * The merged gas top-up flow (PR #57's GoodDollar faucet + Phase 1A's
 * per-transaction requirement). All I/O is faked; no wallet, no network.
 */
import { describe, expect, it, vi } from "vitest";
import {
  fetchGasStatus,
  GAS_MANUAL_NEEDED,
  GAS_TOP_UP_PROGRESS,
  runGasTopUp,
  topUpConfirmMessage,
  type GasTopUpDeps,
} from "./gasTopUp";

const ADDR = "0x00000000000000000000000000000000000000aa";
const NEED = 45_000_000_000_000_000n; // 0.045 CELO, a typical submitScore today

/** A fake /api/gas-faucet whose balance follows `balances` call by call (last value repeats). */
function gasApi(balances: bigint[], opts: { fail?: boolean } = {}) {
  const urls: string[] = [];
  let i = 0;
  const fetchFn = vi.fn(async (url: string) => {
    urls.push(url);
    if (opts.fail) return { ok: false, json: async () => ({}) } as Response;
    const required = BigInt(new URL(url, "http://x").searchParams.get("minWei") ?? "60750000000000000");
    const balance = balances[Math.min(i++, balances.length - 1)];
    return {
      ok: true,
      json: async () => ({ balance: balance.toString(), requiredWei: required.toString(), balanceSufficient: balance >= required }),
    } as Response;
  });
  return { fetchFn, urls };
}

function deps(over: Partial<GasTopUpDeps> & { fetchFn: GasTopUpDeps["fetchFn"] }): GasTopUpDeps & {
  markFaucetUsed: ReturnType<typeof vi.fn>;
  triggerFaucet: ReturnType<typeof vi.fn> | null;
} {
  // Time moves only when the flow sleeps, as it does for real.
  let t = 0;
  return {
    triggerFaucet: vi.fn(async () => "topped_via_api"),
    canUseFaucet: vi.fn(async () => true),
    markFaucetUsed: vi.fn(async () => {}),
    sleep: async (ms: number) => {
      t += ms;
    },
    now: () => t,
    ...over,
  } as any;
}

describe("runGasTopUp", () => {
  it("does nothing when the wallet already covers this transaction's requirement", async () => {
    const api = gasApi([NEED]);
    const d = deps({ fetchFn: api.fetchFn });
    const r = await runGasTopUp({ address: ADDR, requiredWei: NEED, deps: d });
    expect(r.ok).toBe(true);
    expect(d.triggerFaucet).not.toHaveBeenCalled();
    expect(api.urls[0]).toContain(`minWei=${NEED}`);
  });

  it("uses the faucet, polls until the requirement is met, and marks the faucet used", async () => {
    const api = gasApi([0n, 0n, 0n, NEED]); // CELO lands on the third poll
    const d = deps({ fetchFn: api.fetchFn });
    const progress: string[] = [];
    const r = await runGasTopUp({ address: ADDR, requiredWei: NEED, onProgress: (m) => progress.push(m), deps: d });
    expect(r.ok).toBe(true);
    expect(progress).toEqual([GAS_TOP_UP_PROGRESS]);
    expect(d.markFaucetUsed).toHaveBeenCalledTimes(1);
    // every poll checks against the same requirement, not the server default
    expect(api.urls.every((u) => u.includes(`minWei=${NEED}`))).toBe(true);
  });

  it("keeps polling past a top-up that arrives but doesn't cover the requirement", async () => {
    const api = gasApi([0n, 10n ** 16n, 10n ** 16n, 10n ** 16n]); // 0.01 CELO arrives, never enough
    const d = deps({ fetchFn: api.fetchFn });
    const r = await runGasTopUp({ address: ADDR, requiredWei: NEED, deps: d });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("The faucet added some CELO");
    expect(r.error).toContain("0.0450");
    expect(d.markFaucetUsed).toHaveBeenCalledTimes(1); // it did pay out
  });

  it("doesn't mark the faucet used when no CELO arrived within 30 s", async () => {
    const api = gasApi([0n]);
    const d = deps({ fetchFn: api.fetchFn });
    const r = await runGasTopUp({ address: ADDR, requiredWei: NEED, deps: d });
    expect(r).toEqual({ ok: false, error: GAS_MANUAL_NEEDED });
    expect(d.markFaucetUsed).not.toHaveBeenCalled();
    expect(api.fetchFn.mock.calls.length).toBe(1 + 15); // first check + 30 s of 2 s polls
  });

  it("falls back to the manual modal without polling when the faucet skips or errors", async () => {
    for (const outcome of ["skipped", "error"]) {
      const api = gasApi([0n]);
      const d = deps({ fetchFn: api.fetchFn, triggerFaucet: vi.fn(async () => outcome) });
      const r = await runGasTopUp({ address: ADDR, requiredWei: NEED, deps: d });
      expect(r).toEqual({ ok: false, error: GAS_MANUAL_NEEDED });
      expect(api.fetchFn).toHaveBeenCalledTimes(1);
      expect(d.markFaucetUsed).not.toHaveBeenCalled();
    }
  });

  it("skips the faucet when the wallet already used it, or the clients aren't ready", async () => {
    const used = deps({ fetchFn: gasApi([0n]).fetchFn, canUseFaucet: vi.fn(async () => false) });
    expect((await runGasTopUp({ address: ADDR, requiredWei: NEED, deps: used })).ok).toBe(false);
    expect(used.triggerFaucet).not.toHaveBeenCalled();
    const notReady = deps({ fetchFn: gasApi([0n]).fetchFn, triggerFaucet: null });
    expect(await runGasTopUp({ address: ADDR, requiredWei: NEED, deps: notReady })).toEqual({ ok: false, error: GAS_MANUAL_NEEDED });
  });

  it("never spends the faucet when the balance can't be checked", async () => {
    const d = deps({ fetchFn: gasApi([0n], { fail: true }).fetchFn });
    const r = await runGasTopUp({ address: ADDR, requiredWei: NEED, deps: d });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Could not verify wallet balance/);
    expect(d.triggerFaucet).not.toHaveBeenCalled();
  });
});

describe("fetchGasStatus", () => {
  it("returns null, not 'insufficient', when the check fails", async () => {
    expect(await fetchGasStatus(ADDR, NEED, gasApi([0n], { fail: true }).fetchFn)).toBeNull();
  });
});

describe("topUpConfirmMessage ('I've topped up')", () => {
  it("closes when the balance covers the requirement, or when the check couldn't run", () => {
    expect(topUpConfirmMessage({ balance: NEED, requiredWei: NEED, sufficient: true })).toBeNull();
    expect(topUpConfirmMessage(null)).toBeNull();
  });
  it("says nothing has arrived at a zero balance", () => {
    expect(topUpConfirmMessage({ balance: 0n, requiredWei: NEED, sufficient: false })).toMatch(/No CELO has arrived yet/);
  });
  it("says how much more is needed when some CELO is there", () => {
    expect(topUpConfirmMessage({ balance: 10n ** 16n, requiredWei: NEED, sufficient: false })).toBe(
      "Your wallet has 0.0100 CELO; this needs up to 0.0450. Top up a little more, then try again.",
    );
  });
});
