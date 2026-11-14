/** Invite links: the pure rules (lib/referrals.ts). */
import { describe, expect, it } from "vitest";
import { EVENT_BIT } from "./stats/config";
import type { AddrRow } from "./stats/state";
import {
  countByInviter, decideReferral, inviteListMessage, issuedAtIsFresh, normalizeAddress, parseRecords,
  rankInviters, referralsCsv, secretMatches, startedAGame, SIGN_WINDOW_MS,
} from "./referrals";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const row = (events: string[]): AddrRow => [1, 1, events.length, 0, events.reduce((m, e) => m | (1 << EVENT_BIT[e]), 0), "0"];

describe("decideReferral", () => {
  const base = { invitee: A, referrer: B, inviteeInRegistry: false, inviteeOnChain: false, referrerKnown: true };
  it("accepts a brand-new wallet invited by a known player", () => expect(decideReferral(base)).toBe("ok"));
  it("rejects a missing or malformed ref", () => expect(decideReferral({ ...base, referrer: null })).toBe("invalid"));
  it("rejects inviting yourself", () => expect(decideReferral({ ...base, referrer: A })).toBe("self"));
  it("rejects a wallet that signed in before", () => expect(decideReferral({ ...base, inviteeInRegistry: true })).toBe("not_new"));
  it("rejects a wallet already active on chain", () => expect(decideReferral({ ...base, inviteeOnChain: true })).toBe("not_new"));
  it("rejects an inviter nobody knows", () => expect(decideReferral({ ...base, referrerKnown: false })).toBe("unknown_referrer"));
});

describe("normalizeAddress", () => {
  it("lowercases a valid address and rejects anything else", () => {
    expect(normalizeAddress("0x00000000000000000000000000000000000000A1")).toBe(A);
    expect(normalizeAddress("0x123")).toBeNull();
    expect(normalizeAddress("SlideMaster")).toBeNull();
    expect(normalizeAddress(undefined)).toBeNull();
  });
});

describe("counting", () => {
  it("played means the wallet has started a game", () => {
    expect(startedAGame(row(["SessionStarted"]))).toBe(true);
    expect(startedAGame(row(["UsernameSet"]))).toBe(false);
    expect(startedAGame(undefined)).toBe(false);
  });

  it("counts joined and played per inviter and ranks by played, then joined", () => {
    const records = {
      "0x1": { referrer: A, at: 1 }, "0x2": { referrer: A, at: 2 }, "0x3": { referrer: A, at: 3 },
      "0x4": { referrer: B, at: 4 }, "0x5": { referrer: B, at: 5 },
    };
    const played = new Set(["0x4", "0x5", "0x1"]);
    const counts = countByInviter(records, (i) => played.has(i));
    expect(counts.get(A)).toEqual({ address: A, joined: 3, played: 1 });
    expect(counts.get(B)).toEqual({ address: B, joined: 2, played: 2 });
    expect(rankInviters(counts.values(), 10).map((c) => c.address)).toEqual([B, A]);
    expect(rankInviters(counts.values(), 1)).toHaveLength(1);
  });

  it("skips stored records it can't read instead of guessing", () => {
    const parsed = parseRecords({
      [A]: JSON.stringify({ referrer: B, at: 5 }),
      "not-an-address": JSON.stringify({ referrer: B, at: 5 }),
      "0x00000000000000000000000000000000000000c3": "{broken",
      "0x00000000000000000000000000000000000000d4": JSON.stringify({ referrer: "nope", at: 5 }),
    });
    expect(parsed).toEqual({ [A]: { referrer: B, at: 5 } });
  });
});

describe("signed invitee list", () => {
  it("the message names the wallet and the time", () => {
    expect(inviteListMessage("0x00000000000000000000000000000000000000A1", "2026-11-14T10:00:00.000Z"))
      .toBe(`BlockSlide: show the players I invited\nWallet: ${A}\nIssued: 2026-11-14T10:00:00.000Z`);
  });

  it("a signature is accepted only for a short time", () => {
    const now = Date.parse("2026-11-14T10:00:00Z");
    expect(issuedAtIsFresh(new Date(now - 60_000).toISOString(), now)).toBe(true);
    expect(issuedAtIsFresh(new Date(now - SIGN_WINDOW_MS - 1).toISOString(), now)).toBe(false);
    expect(issuedAtIsFresh(new Date(now + 10 * 60_000).toISOString(), now)).toBe(false);
    expect(issuedAtIsFresh("yesterday", now)).toBe(false);
    expect(issuedAtIsFresh(undefined, now)).toBe(false);
  });
});

describe("owner export", () => {
  it("writes CSV with a header and escapes awkward values", () => {
    const csv = referralsCsv([
      { inviter: B, inviterUsername: 'Has "quotes", commas', invitee: A, inviteeUsername: null, joinedAt: "2026-11-14T10:00:00.000Z", played: true },
      { inviter: B, inviterUsername: null, invitee: A, inviteeUsername: "x", joinedAt: "2026-11-14T10:00:00.000Z", played: null },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("inviter,inviter_username,invitee,invitee_username,joined_at,played");
    expect(lines[1]).toBe(`${B},"Has ""quotes"", commas",${A},,2026-11-14T10:00:00.000Z,true`);
    expect(lines[2]).toBe(`${B},,${A},x,2026-11-14T10:00:00.000Z,`);
  });

  it("the key must match exactly, and a missing key never matches", () => {
    expect(secretMatches("abc123", "abc123")).toBe(true);
    expect(secretMatches("abc124", "abc123")).toBe(false);
    expect(secretMatches("abc", "abc123")).toBe(false);
    expect(secretMatches(null, "abc123")).toBe(false);
    expect(secretMatches("abc123", undefined)).toBe(false);
  });
});
