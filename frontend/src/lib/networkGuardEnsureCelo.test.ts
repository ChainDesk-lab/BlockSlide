/**
 * The network guard's ensureCelo(), which New Game, Submit and Shop purchases await before doing
 * anything with a browser wallet. Rendered with React's test renderer against a fake EIP-1193
 * wallet: it asks nothing of an email wallet or a wallet already on Celo, switches a wallet on
 * another network, reports a refusal, and shares a prompt already open instead of opening another.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import type { NetworkGuardState } from "../hooks/useNetworkGuard";

const PLAYER = "0x00000000000000000000000000000000000000a1";
const CELO = 42220;

/** A browser wallet: its real chain, and how it answers a switch request. */
const wallet = {
  chainId: 1,
  onSwitch: "approve" as "approve" | "reject" | "hold",
  release: null as null | (() => void),
};
const listeners = new Set<(chainIdHex: string) => void>();
const provider = {
  request: vi.fn(async ({ method }: { method: string; params?: readonly unknown[] }): Promise<unknown> => {
    if (method === "eth_chainId") return `0x${wallet.chainId.toString(16)}`;
    if (method === "wallet_switchEthereumChain") {
      if (wallet.onSwitch === "reject") throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      if (wallet.onSwitch === "hold") await new Promise<void>((resolve) => { wallet.release = resolve; });
      wallet.chainId = CELO;
      for (const l of listeners) l("0xa4ec");
      return null;
    }
    throw new Error(`unexpected wallet request ${method}`);
  }),
  on: (event: string, l: (chainIdHex: string) => void) => { if (event === "chainChanged") listeners.add(l); },
  removeListener: (event: string, l: (chainIdHex: string) => void) => { if (event === "chainChanged") listeners.delete(l); },
};
const connector = { uid: "injected-1", getProvider: async () => provider, emitter: { emit: vi.fn() } };
/** What wagmi reports for the connection (its chain can lag the wallet's). */
const account = { chainId: 1 };

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: PLAYER, connector, chainId: account.chainId, status: "connected" }),
  useDisconnect: () => ({ disconnect: () => {} }),
}));

import { useCeloOnboardingController } from "../hooks/useNetworkGuard";

let guard!: NetworkGuardState;
let renderer: ReactTestRenderer | null = null;
async function mount(enabled = true) {
  const Probe = () => {
    guard = useCeloOnboardingController(enabled);
    return null;
  };
  await act(async () => {
    renderer = create(createElement(Probe));
  });
}
const switchRequests = () => provider.request.mock.calls.filter(([a]) => a.method === "wallet_switchEthereumChain").length;
const anyWalletRequest = () => provider.request.mock.calls.length;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(wallet, { chainId: 1, onSwitch: "approve", release: null });
  account.chainId = 1;
  listeners.clear();
  provider.request.mockClear();
  connector.emitter.emit.mockClear();
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.restoreAllMocks();
});

describe("ensureCelo", () => {
  it("an email (Magic) sign-in: ok at once, and the browser wallet is never asked anything", async () => {
    await mount(false);
    let r: unknown;
    await act(async () => { r = await guard.ensureCelo(); });
    expect(r).toEqual({ ok: true });
    expect(anyWalletRequest()).toBe(0);
  });

  it("a wallet already on Celo: ok at once, with no wallet request", async () => {
    wallet.chainId = CELO;
    account.chainId = CELO;
    await mount();
    let r: unknown;
    await act(async () => { r = await guard.ensureCelo(); });
    expect(r).toEqual({ ok: true });
    expect(anyWalletRequest()).toBe(0);
  });

  it("a wallet on another network is asked to switch, and ok once it really reports Celo", async () => {
    wallet.onSwitch = "hold"; // the automatic prompt on connect is still open when the player taps
    await mount();
    expect(switchRequests()).toBe(1);
    let r: unknown;
    await act(async () => {
      const tapped = guard.ensureCelo();
      wallet.release?.();
      r = await tapped;
    });
    expect(r).toEqual({ ok: true });
    expect(switchRequests()).toBe(1); // shared the open prompt instead of opening a second one
    expect(wallet.chainId).toBe(CELO);
  });

  it("a refused switch: not ok, with the reason, and the player's tap asks again", async () => {
    wallet.onSwitch = "reject";
    await mount(); // the automatic prompt on connect is refused
    expect(switchRequests()).toBe(1);
    let r: unknown;
    await act(async () => { r = await guard.ensureCelo(); });
    expect(r).toEqual({ ok: false, reason: "rejected" });
    expect(switchRequests()).toBe(2); // a tap is the player's own request, so it asks again
    expect(guard.status).toBe("needs-action");
  });
});
