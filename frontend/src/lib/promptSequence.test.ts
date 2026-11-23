import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  nextPrompt, isTelegramDue, markTelegramShown, markTelegramJoined, dismissTelegramForWeek, isNewGameStart,
} from "./promptSequence";

const base = { verified: false, verificationUnsettled: false, verifyShownThisVisit: false, voteDue: true, telegramDue: true };

describe("pop-up order", () => {
  it("unverified players get only the verify prompt, once per visit", () => {
    expect(nextPrompt(base)).toBe("verify");
    expect(nextPrompt({ ...base, verifyShownThisVisit: true })).toBeNull();
  });
  it("verified players get vote first, then Telegram, then nothing", () => {
    const v = { ...base, verified: true };
    expect(nextPrompt(v)).toBe("vote");
    expect(nextPrompt({ ...v, voteDue: false })).toBe("telegram");
    expect(nextPrompt({ ...v, voteDue: false, telegramDue: false })).toBeNull();
  });
  it("waits while verification is still loading or in progress", () => {
    expect(nextPrompt({ ...base, verificationUnsettled: true })).toBeNull();
  });
});

describe("Telegram prompt state", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  const a = "0xAbC";
  it("is due until shown today, and again tomorrow", () => {
    const day1 = new Date("2026-11-23T10:00:00").getTime();
    expect(isTelegramDue(a, day1)).toBe(true);
    markTelegramShown(a, day1);
    expect(isTelegramDue(a, day1 + 60_000)).toBe(false);
    expect(isTelegramDue(a, day1 + 24 * 3600_000)).toBe(true);
  });
  it("never again after Join", () => {
    markTelegramJoined(a);
    expect(isTelegramDue(a, Date.now() + 30 * 24 * 3600_000)).toBe(false);
  });
  it("stays away for a week after 'don't show this week'", () => {
    const now = Date.now();
    dismissTelegramForWeek(a, now);
    expect(isTelegramDue(a, now + 6 * 24 * 3600_000)).toBe(false);
    expect(isTelegramDue(a, now + 8 * 24 * 3600_000)).toBe(true);
  });
});

describe("game counter", () => {
  it("counts a fresh start and Play Again", () => {
    expect(isNewGameStart("idle", "starting")).toBe(true);
    expect(isNewGameStart("done", "starting")).toBe(true);
    expect(isNewGameStart("active", "starting")).toBe(false);
    expect(isNewGameStart("starting", "active")).toBe(false);
  });
});
