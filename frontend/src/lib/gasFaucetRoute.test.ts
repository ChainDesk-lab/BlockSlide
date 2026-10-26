/**
 * /api/gas-faucet: "sufficient" is measured against the transaction's real
 * requirement, not a fixed 0.001 CELO. The RPC client is mocked; no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

let balance = 0n;
let gasPrice = 202_500_000_000n;
vi.mock("viem", async (orig) => ({
  ...(await orig<typeof import("viem")>()),
  createPublicClient: () => ({
    getBalance: async () => balance,
    getGasPrice: async () => gasPrice,
  }),
}));

const ADDR = "0x00000000000000000000000000000000000000aa";

async function get(qs: string) {
  const { GET } = await import("../../app/api/gas-faucet/route");
  const res = await GET(new Request(`http://localhost/api/gas-faucet?${qs}`) as any);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

afterEach(() => {
  balance = 0n;
  gasPrice = 202_500_000_000n;
});

describe("GET /api/gas-faucet", () => {
  it("no longer calls 0.002 CELO sufficient (the old 0.001 threshold did)", async () => {
    balance = 2n * 10n ** 15n;
    const { body } = await get(`address=${ADDR}`);
    expect(body.balanceSufficient).toBe(false);
    expect(body.requiredWei).toBe((250_000n * 243_000_000_000n).toString());
  });

  it("checks against the caller's own requirement when given", async () => {
    balance = 40_000_000_000_000_000n; // 0.04 CELO
    expect((await get(`address=${ADDR}&minWei=39285000000000000`)).body.balanceSufficient).toBe(true);
    expect((await get(`address=${ADDR}&minWei=45000000000000000`)).body.balanceSufficient).toBe(false);
  });

  it("ignores an invalid minWei and falls back to the default budget", async () => {
    balance = 10n ** 18n;
    const { body } = await get(`address=${ADDR}&minWei=not-a-number`);
    expect(body.requiredWei).toBe((250_000n * 243_000_000_000n).toString());
    expect(body.balanceSufficient).toBe(true);
  });

  it("follows the live gas price", async () => {
    gasPrice = 1_000n * 10n ** 9n;
    const { body } = await get(`address=${ADDR}`);
    expect(body.requiredWei).toBe((250_000n * 1_200n * 10n ** 9n).toString());
  });
});
