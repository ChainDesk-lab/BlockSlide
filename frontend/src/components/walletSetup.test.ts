/**
 * Celo onboarding UI: what the sign-in screen, the header chip and the banner show in each setup
 * state, rendered to static markup with the wallet state mocked (no wallet, no network), plus
 * source checks that keep the wiring honest (one switch path, Celo-pinned purchases, the
 * signed-in gate).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { NetworkGuardState } from "../hooks/useNetworkGuard";
import type { SetupFailure, SetupStatus } from "../lib/celoOnboarding";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

// ── Mocked wallet/auth state ─────────────────────────────────────────────────
const NOOP = () => {};
const guard: NetworkGuardState = {
  status: "idle", restoring: false, failure: null, celebrating: false, interrupted: false, isWrongNetwork: false,
  switchPending: false, switchError: null, hasAttempted: false, retrySwitch: NOOP, ensureCelo: async () => ({ ok: true }),
  disconnectWallet: NOOP, dismissInterrupted: NOOP, registerSurface: () => NOOP, surfaceVisible: false,
};
const auth = { selectedAuth: "wallet" as "wallet" | "email", wagmiConnected: false };
const authValue = { address: "0x1111111111111111111111111111111111111111" as `0x${string}` | undefined, authType: "minipay" as "minipay" | "magic" };

vi.mock("../hooks/useNetworkGuard", () => ({ useNetworkGuard: () => guard }));
vi.mock("../contexts/AuthSelectionContext", () => ({
  useAuthSelection: () => ({ selectedAuth: auth.selectedAuth, setSelectedAuth: NOOP }),
}));
vi.mock("../hooks/useCleanAuth", () => ({ useCleanAuth: () => ({ isReady: true, loading: false, login: async () => {} }) }));
vi.mock("wagmi", async (orig) => ({
  ...(await orig<typeof import("wagmi")>()),
  useAccount: () => ({ isConnected: auth.wagmiConnected }),
}));
vi.mock("./WalletSelector", () => ({ default: () => createElement("div", { "data-testid": "wallet-list" }, "WALLET-LIST") }));
vi.mock("../auth/AuthContext", async (orig) => ({
  ...(await orig<typeof import("../auth/AuthContext")>()),
  useAuth: () => ({ ...authValue, isConnected: false, isReady: true, loading: false, error: null, login: NOOP, logout: NOOP }),
}));
vi.mock("../hooks/useContractData", () => ({ useContractPublicClient: () => null }));
vi.mock("../hooks/useGDollarBalance", () => ({ useGDollarBalance: () => ({ balance: "0", refetch: async () => {} }) }));

function setGuard(status: SetupStatus, failure: SetupFailure | null = null, extra: Partial<NetworkGuardState> = {}) {
  Object.assign(guard, { status, failure, restoring: false, celebrating: false, interrupted: false, surfaceVisible: false }, extra);
}

afterEach(() => {
  setGuard("idle");
  auth.selectedAuth = "wallet";
  auth.wagmiConnected = false;
  authValue.address = "0x1111111111111111111111111111111111111111";
  authValue.authType = "minipay";
});

const JARGON = /rpc|chain ?id|0x[0-9a-f]{3}|eip-?\d|wallet_|4001|4902|-32\d{3}|json/i;
const visibleText = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/** Source without comments, so checks look at code rather than at what comments say. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// ── Setup panel ──────────────────────────────────────────────────────────────
describe("Wallet setup panel", () => {
  const panel = async (status: SetupStatus, failure: SetupFailure | null = null, walletName = "MetaMask") => {
    const { default: WalletSetupPanel } = await import("./WalletSetupPanel");
    return renderToStaticMarkup(createElement(WalletSetupPanel, { status, failure, walletName, onAction: NOOP, onUseDifferentWallet: NOOP }));
  };
  const stageStates = (html: string) => [...html.matchAll(/wallet-setup__stage--(\w+)/g)].map((m) => m[1]);

  it("always shows the three stages in order", async () => {
    const html = await panel("idle");
    const labels = [...html.matchAll(/wallet-setup__label">([^<]+)</g)].map((m) => m[1]);
    expect(labels).toEqual(["Connecting wallet", "Setting up Celo", "Wallet ready"]);
  });

  it.each<[SetupStatus, string[], RegExp]>([
    ["idle", ["current", "todo", "todo"], /Choose the wallet you want to play with/],
    ["connecting", ["current", "todo", "todo"], /Approve the connection in MetaMask/],
    ["checking", ["done", "current", "todo"], /Checking your wallet/],
    ["switching", ["done", "current", "todo"], /Approve the switch to Celo in MetaMask/],
    ["adding", ["done", "current", "todo"], /Approve adding Celo to MetaMask\. You only do this once/],
    ["verifying", ["done", "current", "todo"], /Confirming your wallet is on Celo/],
    ["ready", ["done", "done", "done"], /You're all set/],
  ])("%s", async (status, states, line) => {
    const html = await panel(status);
    expect(stageStates(html)).toEqual(states);
    expect(visibleText(html)).toMatch(line);
    expect(html).toContain('role="status"');
    expect(visibleText(html)).not.toMatch(JARGON);
  });

  it("spins only while it is waiting", async () => {
    expect(await panel("switching")).toContain("wallet-setup__spinner");
    expect(await panel("idle")).not.toContain("wallet-setup__spinner");
    expect(await panel("ready")).not.toContain("wallet-setup__spinner");
  });

  it("after a refusal: plain words, one action, and a way out", async () => {
    const html = await panel("needs-action", "rejected");
    expect(stageStates(html)).toEqual(["done", "attention", "todo"]);
    const text = visibleText(html);
    expect(text).toContain("Switch to Celo to continue");
    expect(text).toContain("Approve the switch in your wallet to keep going");
    expect(html).toMatch(/<button[^>]*wallet-setup__action[^>]*>Switch to Celo<\/button>/);
    expect(html).toContain("Use a different wallet");
    expect(html).toContain('role="alert"');
    expect(text).not.toMatch(JARGON);
  });

  it.each<[SetupFailure, string]>([
    ["add-rejected", "Add Celo"],
    ["unsupported", "Check again"],
    ["timeout", "Try again"],
    ["failed", "Try again"],
    ["wrong-network", "Switch to Celo"],
    ["disconnected", "Connect again"],
  ])("%s offers %s", async (failure, action) => {
    const html = await panel("needs-action", failure);
    expect(html).toMatch(new RegExp(`wallet-setup__action[^>]*>${action}</button>`));
    // A wallet that went away has nothing to switch: the one action is to connect again.
    expect(html.includes("Use a different wallet")).toBe(failure !== "disconnected");
    expect(visibleText(html)).not.toMatch(JARGON);
  });
});

// ── Sign-in modal ────────────────────────────────────────────────────────────
describe("Sign-in modal with a browser wallet", () => {
  const modal = async () => {
    const { default: SignInModal } = await import("./SignInModal");
    return renderToStaticMarkup(createElement(SignInModal));
  };

  it("starts on the usual sign-in choice", async () => {
    auth.selectedAuth = "email";
    const html = await modal();
    expect(html).toContain("Sign in to BlockSlide");
    expect(html).toContain("Continue with email");
    expect(html).toContain("Connect a wallet");
  });

  it("shows the wallet list while connecting, under the stages", async () => {
    setGuard("connecting");
    const html = await modal();
    expect(html).toContain("Choose a wallet");
    expect(html).toContain("WALLET-LIST");
    expect(html).toContain("Connecting wallet");
    expect(html).not.toContain("Continue with email");
    // Nothing picked yet (e.g. WalletConnect pairing in the background on a phone): no approval to ask for.
    expect(html).toContain("Choose the wallet you want to play with.");
    expect(html).not.toContain("Approve the connection");
  });

  it("says it is reconnecting, not asking for approval, while a saved connection comes back", async () => {
    setGuard("connecting", null, { restoring: true });
    const html = await modal();
    expect(html).toContain("Reconnecting your wallet...");
    expect(html).not.toContain("Approve the connection");
  });

  it("keeps a connected wallet that isn't on Celo on the setup view, not the email form", async () => {
    auth.wagmiConnected = true;
    setGuard("switching");
    const html = await modal();
    expect(html).toContain("Setting up your wallet");
    expect(html).toContain("Approve the switch to Celo in your wallet.");
    expect(html).not.toContain("WALLET-LIST");
    expect(html).not.toContain("Continue with email");
  });

  it("explains a refusal and offers the switch again", async () => {
    auth.wagmiConnected = true;
    setGuard("needs-action", "rejected");
    const html = await modal();
    expect(html).toContain("Switch to Celo to continue");
    expect(html).toMatch(/wallet-setup__action[^>]*>Switch to Celo</);
    expect(html).not.toContain("WALLET-LIST");
  });

  it("says Wallet ready before letting the player in", async () => {
    auth.wagmiConnected = true;
    setGuard("ready", null, { celebrating: true });
    const html = await modal();
    expect(html).toMatch(/<h2 class="signin-modal-title">Wallet ready<\/h2>/);
    expect(html.match(/wallet-setup__stage--done/g)).toHaveLength(3);
  });

  it("tells the player when the wallet disconnected during setup", async () => {
    setGuard("idle", null, { interrupted: true });
    const html = await modal();
    expect(html).toContain("Wallet disconnected");
    expect(html).toContain("Your wallet disconnected before setup finished.");
    expect(html).toContain("WALLET-LIST");
  });

  it("leaves email sign-ins alone, whatever wagmi holds", async () => {
    auth.selectedAuth = "email";
    auth.wagmiConnected = true;
    setGuard("idle");
    const html = await modal();
    expect(html).toContain("Continue with email");
    expect(html).not.toContain("wallet-setup");
  });
});

// ── Header chip ──────────────────────────────────────────────────────────────
describe("Header wallet chip", () => {
  const chip = async () => {
    const { default: WalletButton } = await import("./WalletButton");
    return renderToStaticMarkup(createElement(WalletButton));
  };

  it("doesn't show a wallet that is still being set up as connected", async () => {
    setGuard("switching");
    const html = await chip();
    expect(html).toContain("Setting up Celo");
    expect(html).not.toContain("wallet-button__balance");
    expect(html).not.toContain("wallet-button__address");
  });

  it("asks for the switch when the player needs to act", async () => {
    setGuard("needs-action", "rejected");
    const html = await chip();
    expect(html).toContain("wallet-button--attention");
    expect(html).toContain("Switch to Celo");
  });

  it("asks to reconnect a wallet that went away", async () => {
    setGuard("needs-action", "disconnected");
    expect(await chip()).toContain("Reconnect wallet");
  });

  it("shows balance and address once ready", async () => {
    setGuard("ready");
    const html = await chip();
    expect(html).toContain("wallet-button__balance");
    expect(html).toContain("0x1111…1111");
    expect(html).not.toContain("Setting up Celo");
  });

  it("ignores the setup for email wallets", async () => {
    authValue.authType = "magic";
    setGuard("idle");
    expect(await chip()).toContain("wallet-button__address");
  });
});

// ── Banner ───────────────────────────────────────────────────────────────────
describe("Network banner", () => {
  const banner = async () => {
    const { NetworkGuardBanner } = await import("./NetworkGuardBanner");
    return renderToStaticMarkup(createElement(NetworkGuardBanner));
  };

  it("appears only when the player needs to act", async () => {
    for (const s of ["idle", "connecting", "checking", "switching", "adding", "verifying", "ready"] as SetupStatus[]) {
      setGuard(s);
      expect(await banner()).toBe("");
    }
    setGuard("needs-action", "rejected");
    const html = await banner();
    expect(html).toContain("Switch to Celo to continue");
    expect(visibleText(html)).not.toMatch(JARGON);
  });

  it("stays out of the way while the setup view is on screen", async () => {
    setGuard("needs-action", "rejected", { surfaceVisible: true });
    expect(await banner()).toBe("");
  });
});

// ── Wiring ───────────────────────────────────────────────────────────────────
describe("Onboarding wiring", () => {
  const sources = (dir: string): string[] =>
    readdirSync(join(__dirname, dir)).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(join(__dirname, p)).isDirectory()) return sources(p);
      return /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
    });

  it("has one switch path: nothing in the app calls wagmi's switchChain directly", () => {
    for (const f of [...sources(".."), ...sources("../../app")]) {
      const src = code(read(f));
      expect(src, f).not.toMatch(/useSwitchChain|switchChainAsync|\bswitchChain\(/);
    }
  });

  it("pins every Shop purchase to Celo", () => {
    const src = read("../hooks/useShop.ts");
    // Every purchase goes through send(), whose one wagmi write asks for Celo first and is pinned
    // to it (behaviour: lib/shopPurchaseFlow.test.ts).
    expect(src.match(/writeContractAsync\(/g)).toHaveLength(1);
    expect(src).toMatch(/await ensureCelo\(\)[\s\S]*?writeContractAsync\(\{ \.\.\.\(req as any\), chainId: TARGET_CHAIN\.id \}\)/);
  });

  it("counts a browser wallet as signed in only once it is ready on Celo", () => {
    const src = read("../auth/UnifiedAuthBridge.tsx");
    expect(src).toContain('useCeloOnboardingController(selectedAuth === "wallet")');
    expect(src).toMatch(/const walletReady = wagmiConnected && walletSetup\.status === "ready" && !walletSetup\.celebrating;/);
    expect(src).toMatch(/isConnected: walletReady,/);
  });

  it("talks to the chosen wallet's own provider, never window.ethereum", () => {
    const src = code(read("../hooks/useNetworkGuard.tsx"));
    expect(src).toContain("await conn.getProvider()");
    expect(src).not.toMatch(/window\.ethereum/);
  });
});
