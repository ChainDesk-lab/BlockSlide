/**
 * Referrals: the app must not send a transaction on its own when a referred player connects.
 *
 * The old automatic registerReferrer call hard-coded selector 0xe8a98a7a, which matches no
 * function on Game2048 (registerReferrer(address) is 0x9ea7685a) and the contract has no fallback,
 * so every attempt reverted and cost the player gas. On Celo, 5 such transactions from 2 players
 * all reverted, and no referrer was ever registered. Capturing ?ref= is unchanged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { toFunctionSelector } from "viem";
import { InviteCard } from "../components/ProfilePanels";
import { clearPendingReferrer, getPendingReferrer } from "../hooks/useRefCapture";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function sources(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (name === "node_modules" || name.endsWith(".test.ts")) return [];
    if (statSync(join(root, rel)).isDirectory()) return sources(rel);
    return /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Referral registration", () => {
  it("the selector the old code used is not registerReferrer's", () => {
    expect(toFunctionSelector("function registerReferrer(address referrer)")).toBe("0x9ea7685a");
    expect(toFunctionSelector("function registerReferrer(address referrer)")).not.toBe("0xe8a98a7a");
  });

  it("nothing in the app sends a referral transaction on connect", () => {
    const files = [...sources("src"), ...sources("app")];
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toContain("0xe8a98a7a");
      expect(src, f).not.toContain("useReferrerRegistration");
    }
    expect(read("src/App.tsx")).not.toMatch(/registerReferrer\s*\(/);
  });

  it("?ref= links are still captured on every entry point", () => {
    expect(read("app/AppRoot.tsx")).toContain("useRefCapture();");
    expect(read("app/ClientLayout.tsx")).toContain("useRefCapture();");
  });

  it("a captured referrer stays stored for a later, explicit registration", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const ref = "0x00000000000000000000000000000000000000b2";
    store.set("bs_device_pendingReferrer", ref);
    expect(getPendingReferrer()).toBe(ref);
    store.set("bs_device_pendingReferrer", "not-an-address");
    expect(getPendingReferrer()).toBeNull();
    clearPendingReferrer();
    expect(store.size).toBe(0);
  });
});

describe("Invite card", () => {
  it("doesn't promise rewards the contract doesn't pay", () => {
    const html = renderToStaticMarkup(
      createElement(InviteCard, { refLink: "https://blockslide.app/?ref=0xabc", copied: false, referral: "No referrals yet", onCopy: () => {}, onShare: () => {} }),
    );
    expect(html).toContain("Share your link and grow the BlockSlide community.");
    expect(html).not.toMatch(/reward|earn/i);
    // Game2048.registerReferrer only records the referrer and a count; it transfers nothing.
    const fn = read("../contracts/Game2048.sol").match(/function registerReferrer[\s\S]*?\n {4}\}/)?.[0] ?? "";
    expect(fn).toContain("referralCount[referrer]++");
    expect(fn).not.toMatch(/transfer|_sendReward|_awardXp/);
  });
});
