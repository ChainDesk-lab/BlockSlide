/**
 * Season 5 stability pass: regression tests. Everything external (Redis, wallet, auth) is
 * mocked; nothing reaches a network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type FC } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BaseError, keccak256 } from "viem";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

// ── Redis: one shared, fail-fast client ──────────────────────────────────────
const kv = new Map<string, string>();
const fakeRedis = {
  isOpen: true,
  get: async (k: string) => kv.get(k) ?? null,
  setEx: async (k: string, _t: number, v: string) => void kv.set(k, v),
};
let redisUp = false;
vi.mock("../../app/api/_lib/redis", () => ({ getRedis: async () => (redisUp ? fakeRedis : null) }));

// ── Sign-in modal dependencies ───────────────────────────────────────────────
vi.mock("../contexts/AuthSelectionContext", () => ({ useAuthSelection: () => ({ setSelectedAuth: () => {} }) }));
vi.mock("../hooks/useCleanAuth", () => ({ useCleanAuth: () => ({ isReady: true, loading: false, login: async () => {} }) }));
vi.mock("wagmi", async (orig) => ({ ...(await orig<typeof import("wagmi")>()), useAccount: () => ({ isConnected: false }) }));
vi.mock("../components/WalletSelector", () => ({ default: () => null }));
// useGameSession pulls in the GoodDollar SDK, which doesn't load under node; only its error text is tested.
vi.mock("../hooks/useGasFaucet", () => ({ useGasFaucet: () => ({ topUpGasIfNeeded: async () => ({ ok: false }) }) }));

afterEach(() => {
  kv.clear();
  redisUp = false;
});

const ADDR = "0x00000000000000000000000000000000000000a1";
const SEED = ("0x" + "ab".repeat(32)) as `0x${string}`;
const SEED_HASH = keccak256(SEED);
const post = (body: unknown) =>
  new Request("http://localhost/api/game/seed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = () => new Request(`http://localhost/api/game/seed?address=${ADDR}&seedHash=${SEED_HASH}`);

describe("Seed backup API uses the shared Redis client", () => {
  it("answers straight away while Redis is down, then works once it is back (no stuck client)", async () => {
    const { POST, GET } = await import("../../app/api/game/seed/route");
    redisUp = false;
    expect((await POST(post({ address: ADDR, seedHash: SEED_HASH, seed: SEED }) as any)).status).toBe(500);
    expect((await GET(get() as any)).status).toBe(404);

    redisUp = true;
    expect((await POST(post({ address: ADDR, seedHash: SEED_HASH, seed: SEED }) as any)).status).toBe(201);
    const res = await GET(get() as any);
    expect(res.status).toBe(200);
    expect((await res.json()).seed).toBe(SEED);
  });

  it("neither the seed route nor the faucet tracker builds its own Redis client any more", () => {
    for (const f of ["../../app/api/game/seed/route.ts", "./faucet.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/createClient|from "redis"/);
      expect(src, f).toContain("getRedis");
    }
  });
});

describe("Gas faucet tracker", () => {
  it("fails open when Redis is down, and records use when it is up", async () => {
    const { canUseFaucet, markFaucetUsed } = await import("./faucet");
    redisUp = false;
    expect(await canUseFaucet(ADDR)).toBe(true);
    await markFaucetUsed(ADDR); // no throw
    redisUp = true;
    expect(await canUseFaucet(ADDR)).toBe(true);
    await markFaucetUsed(ADDR);
    expect(await canUseFaucet(ADDR)).toBe(false);
  });
});

describe("Score submission messages", () => {
  it("a reverted submission says it reverted, not that the network failed", async () => {
    const { parseContractError, PlayerFacingError } = await import("../hooks/useGameSession");
    const msg = "Score submission reverted on-chain. Your session is still open — try submitting again.";
    expect(parseContractError(new PlayerFacingError(msg))).toBe(msg);
    // Before: a plain Error with this text matched "chain" and read as a connection problem.
    expect(parseContractError(new Error(msg))).toMatch(/Network error/);
  });

  it("wallet and provider errors are still translated as before", async () => {
    const { parseContractError } = await import("../hooks/useGameSession");
    expect(parseContractError(new Error("User rejected the request"))).toBe("You rejected the transaction.");
    expect(parseContractError(new Error("max fee per gas less than block base fee"))).toMatch(/Gas price too low/);
    expect(parseContractError(new BaseError("chain mismatch"))).toMatch(/Network error/);
  });

  it("the seed backup calls can't hold up starting or submitting (timeout, with a fallback for old browsers)", () => {
    const src = read("../hooks/useGameSession.ts");
    expect(src.match(/signal: seedApiSignal\(\)/g)).toHaveLength(2);
    expect(src).toContain('typeof AbortSignal.timeout === "function"');
  });

  it("start and submit re-read the chain and wallet type when they change", () => {
    const src = read("../hooks/useGameSession.ts");
    const deps = [...src.matchAll(/\n {4}\[(address, isConnected, contractDeployed[^\]]*)\],\n {2}\);/g)].map((m) => m[1]);
    expect(deps).toHaveLength(2); // startSession, submitScoreOnce
    for (const d of deps) for (const name of ["authType", "chainId", "isWrongChain"]) expect(d).toContain(name);
  });
});

describe("Bounty standings", () => {
  it("a hung subgraph times out instead of holding the request open", () => {
    const src = read("../../app/api/bounties/route.ts");
    expect(src).toContain("signal: AbortSignal.timeout(SUBGRAPH_TIMEOUT_MS)");
    expect(src).toMatch(/const SUBGRAPH_TIMEOUT_MS = 10_000;/);
  });
});

describe("Sign-in modal", () => {
  it("as the app's sign-in gate it shows no Close button that does nothing", async () => {
    const { default: SignInModal } = await import("../components/SignInModal");
    const gate = renderToStaticMarkup(createElement(SignInModal));
    expect(gate).toContain("Sign in to BlockSlide");
    expect(gate).not.toContain('aria-label="Close"');
  });

  it("when the caller can close it, the Close button is there", async () => {
    const { default: SignInModal } = await import("../components/SignInModal");
    const Modal = SignInModal as FC<{ onClose?: () => void }>;
    expect(renderToStaticMarkup(createElement(Modal, { onClose: () => {} }))).toContain('aria-label="Close"');
  });
});
