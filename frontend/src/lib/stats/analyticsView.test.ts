import { describe, it, expect } from "vitest";
import { describeEvent, fillDays, rangeStart, sum, timeAgo } from "./analyticsView";
import { shapeTopScores } from "./topScores";

describe("rangeStart", () => {
  it("counts the last day as day one and never goes before the first day", () => {
    expect(rangeStart("7d", "2026-10-29", "2026-06-11")).toBe("2026-10-23");
    expect(rangeStart("30d", "2026-10-29", "2026-06-11")).toBe("2026-09-30");
    expect(rangeStart("all", "2026-10-29", "2026-06-11")).toBe("2026-06-11");
    expect(rangeStart("30d", "2026-10-29", "2026-10-25")).toBe("2026-10-25");
  });
});

describe("fillDays", () => {
  it("fills days with no entry as zero, inside the range only", () => {
    const rows = [{ day: "2026-10-01", n: 3 }, { day: "2026-10-03", n: 2 }, { day: "2026-09-30", n: 9 }];
    const out = fillDays(rows, "2026-10-01", "2026-10-04", (r) => r.n);
    expect(out).toEqual([
      { day: "2026-10-01", value: 3 }, { day: "2026-10-02", value: 0 },
      { day: "2026-10-03", value: 2 }, { day: "2026-10-04", value: 0 },
    ]);
    expect(sum(out)).toBe(5);
    expect(fillDays(rows, "2026-10-05", "2026-10-04", (r) => r.n)).toEqual([]);
  });
});

describe("describeEvent", () => {
  it("only reports fields the event carried", () => {
    expect(describeEvent({ block: 1, tx: null, type: "ScoreSubmitted", player: "0x1", score: 11480, tile: 1024 }))
      .toEqual({ label: "Completed a game", detail: "Score 11,480 · 1024 tile" });
    expect(describeEvent({ block: 1, tx: null, type: "ScoreSubmitted", player: "0x1" }).detail).toBe("");
    expect(describeEvent({ block: 1, tx: null, type: "RewardPaid", player: "0x1", tile: 512, amountWei: "15000000000000000000" }).detail)
      .toBe("15 G$ · 512 milestone");
    expect(describeEvent({ block: 1, tx: null, type: "RewardPaid", player: "0x1", amountWei: "1250000000000000000" }).detail)
      .toBe("1.25 G$");
  });
});

describe("timeAgo", () => {
  it("rounds to the largest whole unit", () => {
    const now = 1_000_000_000_000;
    expect(timeAgo(now / 1000 - 30, now)).toBe("just now");
    expect(timeAgo(now / 1000 - 600, now)).toBe("10 min ago");
    expect(timeAgo(now / 1000 - 7200, now)).toBe("2 h ago");
    expect(timeAgo(now / 1000 - 3 * 86_400, now)).toBe("3 d ago");
  });
});

describe("shapeTopScores", () => {
  it("ranks by score because the contract's array is not sorted", () => {
    // Slot order as read from mainnet on 29 Oct 2026 (first four slots).
    const out = shapeTopScores(
      [11480n, 12072n, 14844n, 15308n].map((score, i) => ({ player: "0x" + String(i + 1).repeat(40), score, highestTile: 1024 })),
      ["Tems", "MELVRICX01_", "Champee_01", "Kwin_Debbi"],
    );
    expect(out.map((r) => [r.rank, r.username, r.score])).toEqual([
      [1, "Kwin_Debbi", 15308], [2, "Champee_01", 14844], [3, "MELVRICX01_", 12072], [4, "Tems", 11480],
    ]);
  });

  it("breaks score ties by highest tile", () => {
    const out = shapeTopScores(
      [{ player: "0x" + "1".repeat(40), score: 100n, highestTile: 64 }, { player: "0x" + "2".repeat(40), score: 100n, highestTile: 128 }],
      ["", ""],
    );
    expect(out.map((r) => r.highestTile)).toEqual([128, 64]);
  });

  const ZERO = "0x0000000000000000000000000000000000000000";
  it("drops empty slots and attaches usernames", () => {
    const out = shapeTopScores(
      [
        { player: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", score: 11480n, highestTile: 1024 },
        { player: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", score: 9000n, highestTile: 512 },
        { player: ZERO, score: 0n, highestTile: 0 },
      ],
      ["alice", ""],
    );
    expect(out).toEqual([
      { rank: 1, player: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", username: "alice", score: 11480, highestTile: 1024 },
      { rank: 2, player: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", username: null, score: 9000, highestTile: 512 },
    ]);
  });
});
