/**
 * New Game and Submit with a browser wallet on the wrong network, rendered with React's test
 * renderer: the hook asks the wallet to switch to Celo and does nothing else. No game starts (no
 * phase change, no seed, no board) and nothing is read, signed or sent for it. A declined or failed
 * switch leaves a clear message; a successful one tells the player to tap again, and nothing carries
 * on by itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import type { GameState } from "./gameLogic";
import type { CeloReadiness, CeloSwitchFailure } from "./celoOnboarding";

const PLAYER = "0x00000000000000000000000000000000000000a1" as const;
const CELO = 42220;
const ETHEREUM = 1;
const BOARD = { score: 2048, highestTile: 128, moveCount: 200, maxCombo: 4, over: true, won: false } as unknown as GameState;
const SEED = ("0x" + "ab".repeat(32)) as `0x${string}`;

/** The wallet's chain as wagmi reports it, and what the network guard answers. */
const wallet = { chainId: ETHEREUM as number };
const ensureCelo = vi.fn(async (): Promise<CeloReadiness> => ({ ok: true }));
const showToast = vi.fn();
const signTransaction = vi.fn();
const signer = { request: vi.fn() };
const publicClient = {
  readContract: vi.fn(),
  simulateContract: vi.fn(),
  estimateGas: vi.fn(),
  getTransactionCount: vi.fn(),
  sendRawTransaction: vi.fn(),
};
const sessionRead = { refetch: vi.fn(async () => ({ data: undefined })) };

vi.mock("wagmi", () => ({
  usePublicClient: () => publicClient,
  useReadContract: () => ({ data: undefined, refetch: sessionRead.refetch }),
  useWaitForTransactionReceipt: () => ({ isSuccess: false, isError: false, data: undefined }),
}));
vi.mock("viem/actions", async (orig) => ({
  ...(await orig<typeof import("viem/actions")>()),
  signTransaction: (...args: unknown[]) => signTransaction(...args),
}));
vi.mock("../hooks/useWalletChainId", () => ({ useWalletChainId: () => wallet.chainId }));
vi.mock("../hooks/useContractData", () => ({ useContractAddress: () => PLAYER }));
vi.mock("../hooks/useNetworkGuard", () => ({
  useNetworkGuard: () => ({ retrySwitch: () => {}, ensureCelo, switchPending: false }),
}));
vi.mock("../hooks/useSigner", () => ({ useSigner: () => ({ signer, error: null }) }));
// The real faucet hook pulls in the GoodDollar SDK, which doesn't load under node.
vi.mock("../hooks/useGasFaucet", () => ({ useGasFaucet: () => ({ topUpGasIfNeeded: async () => ({ ok: false }) }) }));
// A browser wallet counts as signed in only once it is on Celo (Celo onboarding).
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ isConnected: wallet.chainId === CELO, authType: "minipay" }) }));
vi.mock("../contexts/NoGasContext", () => ({ useNoGas: () => ({ triggerNoGas: () => {} }) }));
vi.mock("../contexts/ToastContext", () => ({ useToast: () => ({ showToast }) }));
vi.mock("./seedStorage", () => ({
  storeSeedInIndexedDB: vi.fn(async () => true),
  recoverSeedFromIndexedDB: vi.fn(async () => null),
  clearSeedFromIndexedDB: vi.fn(async () => {}),
}));

import { useGameSession } from "../hooks/useGameSession";

// ── Rendering ─────────────────────────────────────────────────────────────────
let session!: ReturnType<typeof useGameSession>;
let renderer: ReactTestRenderer | null = null;
function Probe() {
  session = useGameSession();
  return null;
}
async function mount() {
  await act(async () => {
    renderer = create(createElement(Probe));
  });
}
/** Re-render after the wallet's chain changed, as wagmi would. */
async function walletMovesTo(chainId: number) {
  wallet.chainId = chainId;
  await act(async () => {
    renderer!.update(createElement(Probe));
  });
}
async function newGame(onSeedReady: (seed: `0x${string}`) => void) {
  await act(async () => {
    await session.startSession(onSeedReady);
  });
}
async function submit() {
  await act(async () => {
    await session.submitScore(BOARD, SEED);
  });
}

/** Nothing was read, simulated, signed or sent for a game. */
function expectNothingSent() {
  expect(publicClient.readContract).not.toHaveBeenCalled();
  expect(publicClient.simulateContract).not.toHaveBeenCalled();
  expect(publicClient.sendRawTransaction).not.toHaveBeenCalled();
  expect(signTransaction).not.toHaveBeenCalled();
  expect(signer.request).not.toHaveBeenCalled();
}

const store = new Map<string, string>();
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  wallet.chainId = ETHEREUM;
  ensureCelo.mockReset();
  ensureCelo.mockImplementation(async () => ({ ok: true }));
  for (const f of [showToast, signTransaction, signer.request, sessionRead.refetch, ...Object.values(publicClient)]) f.mockClear();
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── New Game ──────────────────────────────────────────────────────────────────
describe("New Game with the wallet on another network", () => {
  it("asks the wallet to switch to Celo and starts nothing; a declined switch says what to do", async () => {
    ensureCelo.mockImplementation(async () => ({ ok: false, reason: "rejected" }));
    await mount();
    expect(session.isWrongChain).toBe(true);
    const onSeedReady = vi.fn();

    await newGame(onSeedReady);

    expect(ensureCelo).toHaveBeenCalledTimes(1);
    expect(onSeedReady).not.toHaveBeenCalled(); // no seed, so no board
    expect(session.phase).toBe("idle"); // never "active": no off-chain game that can't be saved
    expect(session.error).toBe("Your wallet is still on another network. Approve the switch to Celo, then tap New Game.");
    expect(showToast).not.toHaveBeenCalled();
    expectNothingSent();
  });

  const failures: CeloSwitchFailure[] = ["rejected", "add-rejected", "unsupported", "timeout", "disconnected", "failed", "cancelled", "no-wallet"];
  it.each(failures)("a switch that ends in %s starts nothing and leaves a message", async (reason) => {
    ensureCelo.mockImplementation(async () => ({ ok: false, reason }));
    await mount();
    const onSeedReady = vi.fn();

    await newGame(onSeedReady);

    expect(onSeedReady).not.toHaveBeenCalled();
    expect(session.phase).toBe("idle");
    expect(session.error).toMatch(/\bthen tap New Game\.$/);
    expectNothingSent();
  });

  it("after a successful switch, nothing starts by itself: the player is told to tap New Game", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
    try {
      await mount();
      const onSeedReady = vi.fn();

      await newGame(onSeedReady);
      expect(showToast).toHaveBeenCalledWith("Your wallet is on Celo now. Tap New Game to start.", "success");
      expect(session.error).toBeNull();

      // The wallet reports Celo and time passes: still no game, and nothing read or sent for one.
      await walletMovesTo(CELO);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(onSeedReady).not.toHaveBeenCalled();
      expect(session.phase).toBe("idle");
      expectNothingSent();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a switch message goes away once the wallet is back on Celo", async () => {
    ensureCelo.mockImplementation(async () => ({ ok: false, reason: "rejected" }));
    await mount();
    await newGame(vi.fn());
    expect(session.error).not.toBeNull();

    await walletMovesTo(CELO);

    expect(session.error).toBeNull();
  });

  it("on Celo, New Game takes the normal path and never asks for a switch", async () => {
    // A live session the device can't resume (no seed stored): the normal pre-flight stops there,
    // before anything is signed.
    publicClient.readContract.mockResolvedValue({
      active: true,
      startTime: BigInt(Math.floor(Date.now() / 1000) - 60),
      seedHash: ("0x" + "cd".repeat(32)) as `0x${string}`,
    });
    wallet.chainId = CELO;
    await mount();
    expect(session.isWrongChain).toBe(false);

    await newGame(vi.fn());

    expect(ensureCelo).not.toHaveBeenCalled();
    expect(publicClient.readContract).toHaveBeenCalledTimes(1); // the normal pre-flight session read
    expect(session.error).toMatch(/already have a game in progress/);
  });
});

// ── Submit ────────────────────────────────────────────────────────────────────
describe("Submit with the wallet on another network", () => {
  it("asks the wallet to switch to Celo and sends nothing; a declined switch says to tap Submit", async () => {
    ensureCelo.mockImplementation(async () => ({ ok: false, reason: "rejected" }));
    await mount();

    await submit();

    expect(ensureCelo).toHaveBeenCalledTimes(1);
    expect(sessionRead.refetch).not.toHaveBeenCalled();
    expect(session.error).toBe("Your wallet is still on another network. Approve the switch to Celo, then tap Submit.");
    expectNothingSent();
  });

  it("after a successful switch the score isn't sent by itself: the player taps Submit again", async () => {
    await mount();

    await submit();

    expect(showToast).toHaveBeenCalledWith("Your wallet is on Celo now. Tap Submit to save your score.", "success");
    expect(session.error).toBeNull();
    expect(sessionRead.refetch).not.toHaveBeenCalled();
    expectNothingSent();
  });
});
