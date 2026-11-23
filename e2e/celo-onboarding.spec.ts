import { test, expect, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { decodeFunctionData, decodeFunctionResult, encodeFunctionResult, keccak256, multicall3Abi, parseAbi, type Hex } from "viem";
import { initGame } from "../frontend/src/lib/gameLogic";

/**
 * Celo onboarding, end to end, against mock browser wallets announced over EIP-6963 (the way
 * the app's injected connector discovers real extensions). Each mock answers like a real wallet:
 * 4902 for a chain it doesn't know, 4001 for a refusal, 4200 for a method it lacks, and it can
 * hold a prompt open until the test answers it. Every signing method is refused and recorded:
 * these tests never ask for a signature or send a transaction.
 *
 * Run against a server for this branch, e.g. `next start -p 3100`:
 *   E2E_BASE_URL=http://127.0.0.1:3100 npx playwright test e2e/celo-onboarding.spec.ts
 * Set E2E_SHOTS_DIR to also save screenshots of each stage.
 */

const CELO = 42220;
const ETHEREUM = 1;
const POLYGON = 137;
const ACCOUNT_A = "0x1111111111111111111111111111111111111111";
const ACCOUNT_B = "0x2222222222222222222222222222222222222222";
const SHOTS = process.env.E2E_SHOTS_DIR;

type SwitchAnswer = "accept" | "reject" | "unsupported" | "ignore" | "accept-late" | "accept-silently" | "hold";
type AddAnswer = "accept-and-switch" | "accept" | "reject" | "hold";
interface MockWallet {
  key: string;
  name: string;
  rdns: string;
  account: string;
  chainId: number;
  knowsCelo?: boolean;
  connect?: "accept" | "reject";
  switches?: SwitchAnswer[];
  add?: AddAnswer;
  lateMs?: number;
  color?: string;
}

const walletA = (o: Partial<MockWallet> = {}): MockWallet => ({
  key: "A", name: "Mock Wallet A", rdns: "com.example.mockwalleta", account: ACCOUNT_A, chainId: ETHEREUM, color: "#6650F4", ...o,
});
const walletB = (o: Partial<MockWallet> = {}): MockWallet => ({
  key: "B", name: "Mock Wallet B", rdns: "com.example.mockwalletb", account: ACCOUNT_B, chainId: POLYGON, color: "#0E7490", ...o,
});

async function installWallets(
  page: Page,
  wallets: MockWallet[],
  theme: "dark" | "light" = "dark",
  /** Extra localStorage entries, e.g. a game the app saved earlier. */
  storage: Record<string, string> = {},
) {
  await page.addInitScript(({ wallets, theme, storage }) => {
    const w = window as any;
    w.__walletLog = {};
    w.__wallets = {};
    w.__forbidden = [];
    try {
      localStorage.setItem("bs_device_seen_htp", "1"); // skip the first-visit tutorial
      localStorage.setItem("bs_device_theme", theme);
      for (const m of wallets) localStorage.setItem(`bs_user_${m.account.toLowerCase()}_username_modal_dismissed`, "true");
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    } catch {}
    // How many times the sign-in card was put on the page: it must stay mounted from picking a
    // wallet until the app opens (a remount means the app flashed in and out).
    w.__cardMounts = 0;
    new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (n instanceof Element && (n.matches(".signin-modal-card") || n.querySelector(".signin-modal-card"))) w.__cardMounts++;
        });
      }
    }).observe(document, { childList: true, subtree: true });
    const SIGNING = /^(eth_sendTransaction|eth_signTransaction|eth_sign|personal_sign|eth_signTypedData.*|wallet_sendCalls)$/;
    const err = (code: number, message: string) => Object.assign(new Error(message), { code });
    const hex = (n: number) => "0x" + n.toString(16);

    wallets.forEach((cfg: any, index: number) => {
      const listeners: Record<string, Function[]> = {};
      const emit = (ev: string, v: unknown) => (listeners[ev] || []).slice().forEach((f) => { try { f(v); } catch {} });
      // A reload keeps the wallet's own state (as a real extension would) via sessionStorage.
      const saved = (k: string) => { try { return sessionStorage.getItem(`__mock_${cfg.key}_${k}`); } catch { return null; } };
      const save = (k: string, v: string) => { try { sessionStorage.setItem(`__mock_${cfg.key}_${k}`, v); } catch {} };
      const state = {
        chainId: Number(saved("chain") ?? cfg.chainId),
        knowsCelo: saved("knowsCelo") === "1" || cfg.knowsCelo !== false,
        connected: saved("connected") === "1",
        switchCount: 0,
        held: null as null | { kind: string; resolve: (a: string) => void },
      };
      let moveAt: number | null = null;
      const log: { method: string; params: unknown }[] = (w.__walletLog[cfg.key] = []);
      const setChain = (id: number, announce = true) => {
        state.chainId = id;
        save("chain", String(id));
        if (announce) emit("chainChanged", hex(id));
      };
      const hold = (kind: string) => new Promise<string>((resolve) => { state.held = { kind, resolve }; });

      const provider = {
        async request({ method, params }: { method: string; params?: unknown[] }) {
          log.push({ method, params: params ?? null });
          if (moveAt !== null && Date.now() >= moveAt) { moveAt = null; setChain(42220, false); }
          if (SIGNING.test(method)) {
            w.__forbidden.push({ wallet: cfg.key, method });
            throw err(4200, "This test wallet never signs.");
          }
          switch (method) {
            case "eth_chainId": return hex(state.chainId);
            case "net_version": return String(state.chainId);
            case "eth_accounts": return state.connected ? [cfg.account] : [];
            case "eth_requestAccounts":
            case "wallet_requestPermissions": {
              if (cfg.connect === "reject") throw err(4001, "User rejected the request.");
              state.connected = true;
              save("connected", "1");
              return method === "eth_requestAccounts"
                ? [cfg.account]
                : [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [cfg.account] }] }];
            }
            case "wallet_getPermissions":
              return state.connected ? [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [cfg.account] }] }] : [];
            case "wallet_revokePermissions":
              state.connected = false;
              save("connected", "0");
              return null;
            case "wallet_switchEthereumChain": {
              const answer = (cfg.switches || [])[state.switchCount] || "accept";
              state.switchCount++;
              if (answer === "unsupported") throw err(4200, "The Provider does not support the requested method.");
              if (!state.knowsCelo) throw err(4902, 'Unrecognized chain ID "0xa4ec". Try adding the chain using wallet_addEthereumChain first.');
              if (answer === "reject") throw err(4001, "User rejected the request.");
              if (answer === "hold") {
                if ((await hold("switch")) === "reject") throw err(4001, "User rejected the request.");
                setChain(42220);
                return null;
              }
              if (answer === "accept") setChain(42220);
              if (answer === "accept-silently") setChain(42220, false);
              if (answer === "accept-late") moveAt = Date.now() + (cfg.lateMs || 2500);
              return null; // "ignore": answers like a success, stays where it is
            }
            case "wallet_addEthereumChain": {
              w.__addParams = params && params[0];
              const answer = cfg.add || "accept-and-switch";
              if (answer === "hold") {
                if ((await hold("add")) === "reject") throw err(4001, "User rejected the request.");
                state.knowsCelo = true;
                save("knowsCelo", "1");
                setChain(42220);
                return null;
              }
              if (answer === "reject") throw err(4001, "User rejected the request.");
              state.knowsCelo = true;
              save("knowsCelo", "1");
              if (answer === "accept-and-switch") setChain(42220);
              return null;
            }
            default:
              return null;
          }
        },
        on(ev: string, f: Function) { (listeners[ev] = listeners[ev] || []).push(f); return provider; },
        removeListener(ev: string, f: Function) { listeners[ev] = (listeners[ev] || []).filter((x) => x !== f); return provider; },
      };

      w.__wallets[cfg.key] = {
        setChain: (id: number) => setChain(id),
        release: (answer: string) => { const h = state.held; state.held = null; h?.resolve(answer); },
        holding: () => state.held?.kind ?? null,
        disconnect: () => {
          state.connected = false;
          save("connected", "0");
          emit("accountsChanged", []);
          emit("disconnect", err(4900, "Disconnected"));
        },
        answerSwitchesWith: (list: string[]) => { cfg.switches = list; state.switchCount = 0; },
        switchCount: () => state.switchCount,
      };

      const icon = "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${cfg.color}"/></svg>`);
      const detail = Object.freeze({
        info: { uuid: `00000000-0000-4000-8000-00000000000${index}`, name: cfg.name, icon, rdns: cfg.rdns },
        provider,
      });
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    });
  }, { wallets, theme, storage });
}

const methods = (page: Page, key: string): Promise<string[]> =>
  page.evaluate((k) => ((window as any).__walletLog[k] || []).map((c: any) => c.method), key);
const count = async (page: Page, key: string, method: string) => (await methods(page, key)).filter((m) => m === method).length;
const holding = (page: Page, key: string) => page.evaluate((k) => (window as any).__wallets[k].holding(), key);
const cardMounts = (page: Page): Promise<number> => page.evaluate(() => (window as any).__cardMounts);
const release = (page: Page, key: string, answer: "accept" | "reject") =>
  page.evaluate(([k, a]) => (window as any).__wallets[k].release(a), [key, answer] as const);

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function openWalletList(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Connect a wallet/ }).click();
  await expect(page.getByRole("heading", { name: "Choose a wallet" })).toBeVisible();
}

/**
 * Answers the game contract's getSession(account) read with an active session, as if a game had
 * been started on-chain earlier: nothing is sent, the app only reads. Every other read goes to
 * Celo unchanged. Handles both a plain eth_call and wagmi's batched multicall (aggregate3).
 * Returns how many getSession reads it answered.
 */
async function fakeActiveSession(page: Page, account: string, seedHash: Hex): Promise<() => number> {
  const GAME = "0xd551317265b9c4d1d453d399d8b8fa0b98d8ceb6";
  const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
  const sessionAbi = parseAbi(["function getSession(address player) view returns ((bool active, uint64 startTime, bytes32 seedHash))"]);
  const fake = encodeFunctionResult({
    abi: sessionAbi,
    functionName: "getSession",
    result: { active: true, startTime: BigInt(Math.floor(Date.now() / 1000) - 120), seedHash },
  });
  const isOurs = (to: string | undefined, data: string | undefined) => {
    if (!to || !data || to.toLowerCase() !== GAME) return false;
    try {
      const { functionName, args } = decodeFunctionData({ abi: sessionAbi, data: data as Hex });
      return functionName === "getSession" && String(args[0]).toLowerCase() === account.toLowerCase();
    } catch {
      return false;
    }
  };
  const subcalls = (data: string) => {
    try {
      const d = decodeFunctionData({ abi: multicall3Abi, data: data as Hex });
      return d.functionName === "aggregate3" ? (d.args[0] as readonly { target: string; callData: Hex }[]) : null;
    } catch {
      return null;
    }
  };
  let answered = 0;
  const handler = async (route: Route) => {
    const req = route.request();
    let body: any;
    try {
      body = req.method() === "POST" ? JSON.parse(req.postData() ?? "") : null;
    } catch {
      body = null;
    }
    const calls: any[] = body ? (Array.isArray(body) ? body : [body]) : [];
    const touches = (c: any) => {
      if (c?.method !== "eth_call") return false;
      const tx = c.params?.[0] ?? {};
      const data = tx.data ?? tx.input;
      if (isOurs(tx.to, data)) return true;
      return tx.to?.toLowerCase() === MULTICALL3 && !!subcalls(data)?.some((s) => isOurs(s.target, s.callData));
    };
    if (!calls.some(touches)) return route.continue();
    const response = await route.fetch();
    const json = await response.json();
    const answers = (Array.isArray(json) ? json : [json]).map((a: any) => {
      const c = calls.find((x) => x.id === a.id);
      if (!c || !touches(c) || a.error) return a;
      const tx = c.params[0];
      const data = tx.data ?? tx.input;
      if (isOurs(tx.to, data)) {
        answered++;
        return { ...a, result: fake };
      }
      const subs = subcalls(data)!;
      const results = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: a.result }) as readonly { success: boolean; returnData: Hex }[];
      const patched = results.map((r, i) => (isOurs(subs[i].target, subs[i].callData) ? (answered++, { success: true, returnData: fake }) : r));
      return { ...a, result: encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: patched }) };
    });
    await route.fulfill({ response, json: Array.isArray(json) ? answers : answers[0] });
  };
  await page.route((url) => url.hostname === "forno.celo.org" || (url.hostname === "rpc.ankr.com" && url.pathname.startsWith("/celo")), handler);
  return () => answered;
}

/** The saved game and the numbers on the board as the player sees them. */
async function boardSnapshot(page: Page, account: string) {
  return {
    saved: await page.evaluate((k) => localStorage.getItem(k), `bs_user_${account.toLowerCase()}_game_state`),
    tiles: (await page.locator(".board .tile-pos:not(.tile-pos--ghost)").allInnerTexts()).map((t) => Number(t)).sort((a, b) => a - b),
  };
}

const statusLine = (page: Page) => page.locator(".wallet-setup__status");
const headerChip = (page: Page) => page.locator("header .wallet-button");

/** Signed in: the app is showing and the header chip shows the wallet as connected. */
async function expectSignedIn(page: Page, short = "0x1111…1111") {
  await expect(page.locator(".signin-modal-card")).toHaveCount(0, { timeout: 15_000 });
  await expect(headerChip(page).locator(".wallet-button__address")).toHaveText(short);
}

test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
});
test.afterEach(async ({ page }) => {
  // Nothing in onboarding (or anything these tests touch) may ask for a signature.
  const forbidden = await page.evaluate(() => (window as any).__forbidden ?? []).catch(() => []);
  expect(forbidden).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test.describe("Celo onboarding with a browser wallet", () => {
  test("a wallet already on Celo goes straight to ready, with no network prompt", async ({ page }) => {
    await installWallets(page, [walletA({ chainId: CELO })]);
    await openWalletList(page);
    const mounts = await cardMounts(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    await expect(page.getByRole("heading", { name: "Wallet ready" })).toBeVisible();
    await expectSignedIn(page);
    expect(await cardMounts(page)).toBe(mounts); // no flash of the app before "Wallet ready"
    expect(await count(page, "A", "wallet_switchEthereumChain")).toBe(0);
    expect(await count(page, "A", "wallet_addEthereumChain")).toBe(0);
  });

  test("a wallet on Ethereum is asked to switch, then confirmed on Celo", async ({ page }) => {
    await installWallets(page, [walletA({ chainId: ETHEREUM, switches: ["hold"] })]);
    await openWalletList(page);
    const mounts = await cardMounts(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    await expect.poll(() => holding(page, "A")).toBe("switch");
    await expect(page.getByRole("heading", { name: "Setting up your wallet" })).toBeVisible();
    await expect(statusLine(page)).toHaveText("Approve the switch to Celo in Mock Wallet A.");
    // Not signed in while the wallet is still on Ethereum, in the header either.
    await expect(headerChip(page)).toContainText("Setting up Celo");
    await expect(headerChip(page).locator(".wallet-button__address")).toHaveCount(0);
    await release(page, "A", "accept");
    await expect(page.getByRole("heading", { name: "Wallet ready" })).toBeVisible();
    await expectSignedIn(page);
    expect(await cardMounts(page)).toBe(mounts);
    expect(await count(page, "A", "wallet_switchEthereumChain")).toBe(1);
    expect(await count(page, "A", "wallet_addEthereumChain")).toBe(0);
    const m = await methods(page, "A");
    expect(m.lastIndexOf("eth_chainId")).toBeGreaterThan(m.indexOf("wallet_switchEthereumChain"));
  });

  test("a wallet on another EVM network (Polygon) is switched too", async ({ page }) => {
    await installWallets(page, [walletA({ chainId: POLYGON })]);
    await openWalletList(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    await expectSignedIn(page);
    expect(await count(page, "A", "wallet_switchEthereumChain")).toBe(1);
  });

  test("a wallet without Celo is asked to add it, with the Celo Mainnet settings", async ({ page }) => {
    await installWallets(page, [walletA({ chainId: ETHEREUM, knowsCelo: false, add: "hold" })]);
    await openWalletList(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    await expect.poll(() => holding(page, "A")).toBe("add");
    await expect(statusLine(page)).toHaveText("Approve adding Celo to Mock Wallet A. You only do this once.");
    await release(page, "A", "accept");
    await expectSignedIn(page);
    expect(await page.evaluate(() => (window as any).__addParams)).toEqual({
      chainId: "0xa4ec",
      chainName: "Celo Mainnet",
      nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
      rpcUrls: ["https://forno.celo.org"],
      blockExplorerUrls: ["https://celoscan.io"],
    });
    expect(await count(page, "A", "wallet_switchEthereumChain")).toBe(1);
    expect(await count(page, "A", "wallet_addEthereumChain")).toBe(1);
  });

  test("a declined switch is explained, never re-asked on its own, and retried on a tap", async ({ page }) => {
    await installWallets(page, [walletA({ chainId: ETHEREUM, switches: ["reject", "accept"] })]);
    await openWalletList(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    const notice = page.getByRole("alert").filter({ hasText: "Switch to Celo to continue" });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Approve the switch in your wallet to keep going.");
    await expect(headerChip(page)).toContainText("Switch to Celo");
    await page.waitForTimeout(3_000);
    expect(await count(page, "A", "wallet_switchEthereumChain")).toBe(1); // no prompt loop
    await notice.getByRole("button", { name: "Switch to Celo" }).click();
    await expectSignedIn(page);
    expect(await count(page, "A", "wallet_switchEthereumChain")).toBe(2);
  });

  test("a wallet that can't switch: the player picks Celo in the wallet and the app notices", async ({ page }) => {
    await installWallets(page, [walletA({ chainId: ETHEREUM, switches: ["unsupported"] })]);
    await openWalletList(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    const notice = page.getByRole("alert").filter({ hasText: "Choose Celo in your wallet" });
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("button", { name: "Check again" })).toBeVisible();
    await page.evaluate(() => (window as any).__wallets.A.setChain(42220)); // the player switches in the wallet
    await expectSignedIn(page);
    expect(await count(page, "A", "wallet_switchEthereumChain")).toBe(1);
  });

  test("a declined connection request is explained and the wallet list stays", async ({ page }) => {
    await installWallets(page, [walletA({ connect: "reject" })]);
    await openWalletList(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    await expect(page.getByText("The connection request was closed. Choose a wallet to try again.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Mock Wallet A/ })).toBeEnabled();
    expect(await count(page, "A", "wallet_switchEthereumChain")).toBe(0);
  });

  test("a wallet that disconnects during setup sends the player back to the list, with a reason", async ({ page }) => {
    await installWallets(page, [walletA({ chainId: ETHEREUM, switches: ["hold"] })]);
    await openWalletList(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    await expect.poll(() => holding(page, "A")).toBe("switch");
    await page.evaluate(() => (window as any).__wallets.A.disconnect());
    await expect(page.getByText("Your wallet disconnected before setup finished.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a wallet" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Mock Wallet A/ })).toBeVisible();
    await expect(headerChip(page)).toHaveCount(0);
  });

  test("with several wallets installed, only the chosen one is asked", async ({ page }) => {
    await installWallets(page, [walletA({ chainId: ETHEREUM }), walletB({ chainId: POLYGON })]);
    await openWalletList(page);
    await page.getByRole("button", { name: /Mock Wallet B/ }).click();
    await expectSignedIn(page, "0x2222…2222");
    expect(await count(page, "B", "wallet_switchEthereumChain")).toBe(1);
    const a = await methods(page, "A");
    expect(a.filter((m) => m.startsWith("wallet_") || m === "eth_requestAccounts")).toEqual([]);
  });

  test("a late switch with no chainChanged event is still confirmed, by reading the chain", async ({ page }) => {
    await installWallets(page, [walletA({ chainId: ETHEREUM, switches: ["accept-late"], lateMs: 2_500 })]);
    await openWalletList(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    await expect(statusLine(page)).toHaveText("Confirming your wallet is on Celo...");
    await expectSignedIn(page);
  });

  test("a wallet that says yes but never switches is not treated as switched", async ({ page }) => {
    test.setTimeout(60_000);
    await installWallets(page, [walletA({ chainId: ETHEREUM, switches: ["ignore", "accept"] })]);
    await openWalletList(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    const notice = page.getByRole("alert").filter({ hasText: "Still waiting for your wallet" });
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(headerChip(page).locator(".wallet-button__address")).toHaveCount(0);
    await notice.getByRole("button", { name: "Try again" }).click();
    await expectSignedIn(page);
  });

  test("a returning player whose wallet is now on another network is set up on load", async ({ page }) => {
    await installWallets(page, [walletA({ chainId: CELO })]);
    await openWalletList(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    await expectSignedIn(page);
    // Between visits the player moved the wallet to Ethereum.
    await page.evaluate(() => sessionStorage.setItem("__mock_A_chain", "1"));
    await page.reload();
    await expectSignedIn(page);
    expect(await count(page, "A", "wallet_switchEthereumChain")).toBe(1);
  });

  test("the wallet moving off Celo while BlockSlide is open: one prompt, then the banner", async ({ page }) => {
    await installWallets(page, [walletA({ chainId: CELO })]);
    await openWalletList(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    await expectSignedIn(page);
    await page.locator("header").getByRole("link", { name: "Stats" }).click();
    await expect(page).toHaveURL(/\/stats/);
    await page.evaluate(() => {
      const wallet = (window as any).__wallets.A;
      wallet.answerSwitchesWith(["reject", "accept"]);
      wallet.setChain(1);
    });
    const banner = page.locator(".network-guard-banner");
    await expect(banner).toContainText("Switch to Celo to continue");
    await expect(headerChip(page)).toContainText("Switch to Celo");
    await expect(headerChip(page).locator(".wallet-button__address")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__wallets.A.switchCount())).toBe(1);
    await banner.getByRole("button", { name: "Switch to Celo" }).click();
    await expect(banner).toHaveCount(0);
    await expect(headerChip(page).locator(".wallet-button__address")).toHaveText("0x1111…1111");
  });

  test("email sign-in is unchanged and never touches a browser wallet", async ({ page }) => {
    await installWallets(page, [walletA({ chainId: ETHEREUM })]);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in to BlockSlide" })).toBeVisible();
    await page.getByPlaceholder("you@example.com").fill("player@example.com");
    await page.getByRole("button", { name: "Continue with email" }).click();
    // This local build has no Magic key, so email sign-in reports itself unavailable, as before.
    await expect(page.getByText(/Email login is not available/)).toBeVisible();
    await expect(page.locator(".wallet-setup")).toHaveCount(0);
    // wagmi's own silent eth_accounts check on page load is all a browser wallet sees: nothing that
    // prompts (connect, switch, add) and no signatures.
    const asked = (await methods(page, "A")).filter((m) => m !== "eth_accounts" && m !== "eth_chainId");
    expect(asked).toEqual([]);
  });

  test("after setup, the app's pages open normally on Celo with no signature requests", async ({ page }) => {
    await installWallets(page, [walletA({ chainId: POLYGON })]);
    await openWalletList(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    await expectSignedIn(page);
    const nav = page.locator("header nav");
    for (const [label, url] of [["Play", /tab=game/], ["Leaderboard", /tab=leaderboard/], ["Shop", /tab=shop/], ["Bounties", /\/bounty/], ["Stats", /\/stats/], ["How to Play", /\/how-to-play/]] as const) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(headerChip(page).locator(".wallet-button__address")).toHaveText("0x1111…1111");
      await expect(page.locator(".network-guard-banner")).toHaveCount(0);
    }
    await nav.getByRole("button", { name: "Profile" }).click();
    await expect(page).toHaveURL(new RegExp(`/profile/${ACCOUNT_A}`, "i"));
    expect(await count(page, "A", "wallet_switchEthereumChain")).toBe(1);
  });

  test("leaving Celo mid-game keeps the board and the session, and restores both on return", async ({ page }) => {
    // A game in progress: the board the app saved for this wallet, and its on-chain session (read
    // only, answered by fakeActiveSession). No transaction is sent at any point.
    const seed = `0x${"5a".repeat(32)}` as Hex;
    const { state } = initGame(seed);
    const saved = JSON.stringify({ seed, state: { ...state, newTiles: [], mergedTiles: [] }, undosUsed: 0 });
    const gameKey = `bs_user_${ACCOUNT_A.toLowerCase()}_game_state`;
    await installWallets(page, [walletA({ chainId: CELO, switches: ["reject", "accept"] })], "dark", { [gameKey]: saved });
    const sessionReads = await fakeActiveSession(page, ACCOUNT_A, keccak256(seed));

    await openWalletList(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    await expectSignedIn(page);
    await page.locator("header nav").getByRole("link", { name: "Play", exact: true }).click();
    const sessionDot = page.locator('section[aria-label="Live standing"] .status-dot');
    await expect(sessionDot).toHaveText("Active"); // the on-chain session is live: this is mid-game
    await expect(page.locator(".board .tile-pos:not(.tile-pos--ghost)")).not.toHaveCount(0);

    // Play a few moves.
    const moveCount = async () => JSON.parse((await page.evaluate((k) => localStorage.getItem(k), gameKey)) ?? "{}").state?.moveCount ?? 0;
    for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(150);
    }
    await expect.poll(moveCount).toBeGreaterThan(0);
    await page.waitForTimeout(500); // let the slide animations settle
    const before = await boardSnapshot(page, ACCOUNT_A);
    expect(before.tiles.length).toBeGreaterThan(0);
    await shot(page, "8-mid-game-on-celo-dark-desktop");

    // The wallet moves to Ethereum mid-game; the player declines the first prompt.
    await page.evaluate(() => (window as any).__wallets.A.setChain(1));
    const notice = page.getByRole("alert").filter({ hasText: "Switch to Celo to continue" });
    await expect(notice).toBeVisible();
    await expect(page.locator(".board")).toHaveCount(0); // not shown as playable while off Celo
    await shot(page, "9-mid-game-off-celo-dark-desktop");
    await page.waitForTimeout(1_000);
    expect(await page.evaluate((k) => localStorage.getItem(k), gameKey)).toBe(before.saved); // nothing changed while away

    // Back on Celo: the same board, the same session, still playable.
    await notice.getByRole("button", { name: "Switch to Celo" }).click();
    await expect(page.locator(".board")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/tab=game/);
    await page.waitForTimeout(500);
    expect(await boardSnapshot(page, ACCOUNT_A)).toEqual(before);
    await expect(sessionDot).toHaveText("Active");
    await shot(page, "10-mid-game-restored-dark-desktop");
    const movesBefore = await moveCount();
    for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(150);
      if ((await moveCount()) > movesBefore) break;
    }
    expect(await moveCount()).toBeGreaterThan(movesBefore);
    expect(sessionReads()).toBeGreaterThan(0);
    expect(await count(page, "A", "wallet_switchEthereumChain")).toBe(2); // one automatic prompt, one tap
  });
});

test.describe("Screenshots", () => {
  test.skip(!SHOTS, "set E2E_SHOTS_DIR to save screenshots");
  for (const theme of ["dark", "light"] as const) {
    for (const [device, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]] as const) {
      test(`stages, ${theme}, ${device}`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize(viewport);
        const tag = `${theme}-${device}`;
        await installWallets(page, [walletA({ chainId: ETHEREUM, knowsCelo: false, add: "hold", switches: ["hold"] })], theme);
        await openWalletList(page);
        await shot(page, `1-choose-wallet-${tag}`);
        await page.getByRole("button", { name: /Mock Wallet A/ }).click();
        await expect.poll(() => holding(page, "A")).toBe("add");
        await expect(statusLine(page)).toContainText("Approve adding Celo");
        await shot(page, `2-setting-up-celo-add-${tag}`);
        await release(page, "A", "accept");
        await expect(page.getByRole("heading", { name: "Wallet ready" })).toBeVisible();
        await shot(page, `4-wallet-ready-${tag}`);
        await expectSignedIn(page);
        await shot(page, `5-signed-in-${tag}`);
      });

      test(`declined switch, ${theme}, ${device}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        const tag = `${theme}-${device}`;
        await installWallets(page, [walletA({ chainId: ETHEREUM, switches: ["hold", "reject"] })], theme);
        await openWalletList(page);
        await page.getByRole("button", { name: /Mock Wallet A/ }).click();
        await expect.poll(() => holding(page, "A")).toBe("switch");
        await expect(statusLine(page)).toHaveText("Approve the switch to Celo in Mock Wallet A.");
        await shot(page, `3-setting-up-celo-switch-${tag}`);
        await release(page, "A", "reject");
        await expect(page.getByRole("alert").filter({ hasText: "Switch to Celo to continue" })).toBeVisible();
        await shot(page, `6-switch-declined-${tag}`);
      });
    }
  }

  test("wallet moved off Celo on another page: banner and header chip", async ({ page }) => {
    await installWallets(page, [walletA({ chainId: CELO })]);
    await openWalletList(page);
    await page.getByRole("button", { name: /Mock Wallet A/ }).click();
    await expectSignedIn(page);
    await page.locator("header").getByRole("link", { name: "Stats" }).click();
    await page.evaluate(() => {
      const wallet = (window as any).__wallets.A;
      wallet.answerSwitchesWith(["reject"]);
      wallet.setChain(1);
    });
    await expect(page.locator(".network-guard-banner")).toContainText("Switch to Celo to continue");
    await headerChip(page).click();
    await shot(page, "7-moved-off-celo-banner-dark-desktop");
  });
});
