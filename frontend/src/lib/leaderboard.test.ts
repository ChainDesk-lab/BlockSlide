import { describe, it, expect } from "vitest";
import {
  mergePlayers,
  tierOf,
  compareRows,
  buildOrderedLeaderboard,
  type MergedPlayer,
} from "./leaderboard";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";
const D = "0xdddddddddddddddddddddddddddddddddddddddd";

function row(p: Partial<MergedPlayer> & { id: string }): MergedPlayer {
  return {
    xp: "0",
    username: null,
    firstSeen: 0,
    isVerified: null,
    ...p,
  };
}

describe("mergePlayers", () => {
  it("includes registry-only wallets with zero XP so no signup is missing", () => {
    const rows = mergePlayers(
      [{ id: A, xp: "500", username: "onchain", firstSeen: "100" }],
      [
        { address: A, username: "registry", createdAt: 50_000 },
        { address: B, username: "newbie", createdAt: 90_000 },
      ]
    );
    expect(rows).toHaveLength(2);
    const b = rows.find((r) => r.id === B)!;
    expect(b.xp).toBe("0");
    expect(b.username).toBe("newbie");
  });

  it("prefers the on-chain username, falls back to registry only when absent", () => {
    const rows = mergePlayers(
      [
        { id: A, xp: "1", username: "chain", firstSeen: "1" },
        { id: B, xp: "1", username: null, firstSeen: "1" },
      ],
      [
        { address: A, username: "reg-a", createdAt: 1000 },
        { address: B, username: "reg-b", createdAt: 1000 },
      ]
    );
    expect(rows.find((r) => r.id === A)!.username).toBe("chain");
    expect(rows.find((r) => r.id === B)!.username).toBe("reg-b");
  });

  it("dedupes by address case-insensitively", () => {
    const rows = mergePlayers(
      [{ id: A.toUpperCase(), xp: "10", username: null, firstSeen: "5" }],
      [{ address: A, username: "x", createdAt: 1000 }]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(A);
  });

  it("adopts the earliest known firstSeen across sources", () => {
    const rows = mergePlayers(
      [{ id: A, xp: "10", username: null, firstSeen: "9999" }],
      [{ address: A, username: null, createdAt: 1_000_000 }] // 1000s epoch
    );
    expect(rows[0].firstSeen).toBe(1000);
  });
});

describe("tierOf", () => {
  it("verified → 0, unverified-with-xp → 1, no-xp → 2", () => {
    expect(tierOf(row({ id: A, isVerified: true, xp: "0" }))).toBe(0);
    expect(tierOf(row({ id: A, isVerified: false, xp: "5" }))).toBe(1);
    expect(tierOf(row({ id: A, isVerified: null, xp: "5" }))).toBe(1);
    expect(tierOf(row({ id: A, isVerified: false, xp: "0" }))).toBe(2);
    expect(tierOf(row({ id: A, isVerified: null, xp: "0" }))).toBe(2);
  });
});

describe("compareRows / ordering", () => {
  it("puts every verified player above every unverified one, regardless of XP", () => {
    const verifiedNoXp = row({ id: A, isVerified: true, xp: "0", firstSeen: 10 });
    const unverifiedHugeXp = row({ id: B, isVerified: false, xp: "999999999", firstSeen: 5 });
    expect(compareRows(verifiedNoXp, unverifiedHugeXp)).toBeLessThan(0);
  });

  it("ranks within a tier by XP descending using BigInt (beyond 2^53)", () => {
    const big = row({ id: A, isVerified: true, xp: "9007199254740993" }); // 2^53 + 1
    const bigger = row({ id: B, isVerified: true, xp: "9007199254740995" }); // 2^53 + 3
    expect(compareRows(bigger, big)).toBeLessThan(0);
  });

  it("is a deterministic total order — no ties, stable across shuffles", () => {
    const verif: Record<string, boolean | null> = { [A]: true, [C]: true };
    const sub = [
      { id: A, xp: "100", username: null, firstSeen: "1" },
      { id: B, xp: "100", username: null, firstSeen: "1" }, // same xp+firstSeen as A but unverified
      { id: C, xp: "100", username: null, firstSeen: "1" },
      { id: D, xp: "0", username: null, firstSeen: "1" },
    ];
    const reg = [
      { address: A, username: null, createdAt: 1000 },
      { address: B, username: null, createdAt: 1000 },
      { address: C, username: null, createdAt: 1000 },
      { address: D, username: null, createdAt: 1000 },
    ];

    const once = buildOrderedLeaderboard(sub, reg, verif).map((r) => r.id);
    const reversed = buildOrderedLeaderboard([...sub].reverse(), [...reg].reverse(), verif).map(
      (r) => r.id
    );

    // A & C verified (tier 0, tie broken by address) → B (tier 1) → D (tier 2)
    expect(once).toEqual([A, C, B, D]);
    expect(reversed).toEqual(once); // order independent of input order
  });

  it("keeps a given player on exactly one page slice (no dup, no gap)", () => {
    const sub = Array.from({ length: 120 }, (_, i) => ({
      id: `0x${String(i).padStart(40, "0")}`,
      xp: String(1000 - i),
      username: null,
      firstSeen: String(i),
    }));
    const ordered = buildOrderedLeaderboard(sub, [], {});
    const PAGE = 50;
    const pages = [
      ordered.slice(0, PAGE),
      ordered.slice(PAGE, 2 * PAGE),
      ordered.slice(2 * PAGE, 3 * PAGE),
    ];
    const seen = new Set<string>();
    for (const page of pages) {
      for (const r of page) {
        expect(seen.has(r.id)).toBe(false); // never duplicated across pages
        seen.add(r.id);
      }
    }
    expect(seen.size).toBe(120); // every player appears exactly once
  });
});
