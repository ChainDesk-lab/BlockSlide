/** Invite links: the pure rules (lib/referrals.ts). */
import { describe, expect, it } from "vitest";
import { EVENT_BIT } from "./stats/config";
import type { AddrRow } from "./stats/state";
import {
  MIN_PAYOUT_G, MIN_PAYOUT_REFERRALS, REFERRAL_REWARD_G, claimableInvitees, countByInviter, decideReferral, inviteListMessage,
  issuedAtIsFresh, normalizeAddress, parsePayout, parseRecords, payoutAmountG, payoutNotification, payoutRequestMessage,
  rankInviters, referralsCsv, secretMatches, startedAGame, SIGN_WINDOW_MS, type PayoutRequest,
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
    const verified = new Set(["0x1", "0x2", "0x4"]);
    const counts = countByInviter(records, (i) => played.has(i), (i) => verified.has(i));
    expect(counts.get(A)).toEqual({ address: A, joined: 3, played: 1, verified: 2, eligible: 1 });
    expect(counts.get(B)).toEqual({ address: B, joined: 2, played: 2, verified: 1, eligible: 1 });
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
      { inviter: B, inviterUsername: 'Has "quotes", commas', invitee: A, inviteeUsername: null, joinedAt: "2026-11-14T10:00:00.000Z", played: true, verified: true, payout: "paid" },
      { inviter: B, inviterUsername: null, invitee: A, inviteeUsername: "x", joinedAt: "2026-11-14T10:00:00.000Z", played: null, verified: null, payout: null },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("inviter,inviter_username,invitee,invitee_username,joined_at,played,verified,payout");
    expect(lines[1]).toBe(`${B},"Has ""quotes"", commas",${A},,2026-11-14T10:00:00.000Z,true,true,paid`);
    expect(lines[2]).toBe(`${B},,${A},x,2026-11-14T10:00:00.000Z,,,`);
  });

  it("the key must match exactly, and a missing key never matches", () => {
    expect(secretMatches("abc123", "abc123")).toBe(true);
    expect(secretMatches("abc124", "abc123")).toBe(false);
    expect(secretMatches("abc", "abc123")).toBe(false);
    expect(secretMatches(null, "abc123")).toBe(false);
    expect(secretMatches("abc123", undefined)).toBe(false);
  });
});

describe("referral payments", () => {
  it("10 referrals are 26,350 G$, 2,635 G$ each", () => {
    expect(REFERRAL_REWARD_G).toBe(2635);
    expect(MIN_PAYOUT_REFERRALS).toBe(10);
    expect(MIN_PAYOUT_G).toBe(26_350);
    expect(payoutAmountG(12)).toBe(31_620);
  });

  it("only referrals that have played AND are verified, and aren't already requested, can be requested", () => {
    const played = new Set(["0x1", "0x2", "0x3", "0x5"]);
    const verified = new Set(["0x1", "0x3", "0x4", "0x5"]);
    const claimed = { "0x5": "req-1" };
    expect(claimableInvitees(["0x1", "0x2", "0x3", "0x4", "0x5"], (i) => played.has(i), (i) => verified.has(i), claimed)).toEqual(["0x1", "0x3"]);
  });

  it("the signed request names the wallet and the payout wallet", () => {
    expect(payoutRequestMessage("0x00000000000000000000000000000000000000A1", "0x00000000000000000000000000000000000000B2", "2026-11-26T10:00:00.000Z"))
      .toBe(`BlockSlide: request my referral payment\nWallet: ${A}\nPay to: ${B}\nIssued: 2026-11-26T10:00:00.000Z`);
  });

  const req: PayoutRequest = {
    id: "req-1", inviter: A, payTo: B, invitees: ["0x1"], count: 10, amountG: 26_350, rewardPerReferralG: 2635,
    status: "pending", createdAt: Date.parse("2026-11-26T10:00:00Z"), snapshot: { joined: 187, played: 160, verified: 12, eligible: 10 },
  };

  it("the owner's message has the amount, payout wallet and all counts, with names escaped", () => {
    const text = payoutNotification(req, "<b>Wol&Gan</b>", "https://blockslide.app");
    expect(text).toContain("26,350 G$ (10 × 2,635 G$)");
    expect(text).toContain(`<code>${B}</code> (a different wallet)`);
    expect(text).toContain("187 joined · 160 played · 12 verified · 10 played and verified");
    expect(text).toContain("&lt;b&gt;Wol&amp;Gan&lt;/b&gt;");
    expect(text).toContain('href="https://blockslide.app/admin/payouts"');
    expect(payoutNotification({ ...req, payTo: A }, null, "https://blockslide.app")).toContain("(their own wallet)");
  });

  it("stored requests that can't be read are skipped", () => {
    expect(parsePayout(JSON.stringify(req))?.id).toBe("req-1");
    expect(parsePayout("{broken")).toBeNull();
    expect(parsePayout(JSON.stringify({ id: "x" }))).toBeNull();
  });
});
