/**
 * /analytics: the contract's on-chain top-10 score table, and the page around it.
 * The RPC is mocked; nothing reaches a network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shapeTopScores } from "./topScores";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";
const ZERO = "0x0000000000000000000000000000000000000000";

describe("shapeTopScores", () => {
  it("ranks by score because the contract array isn't sorted, and drops empty slots", () => {
    const rows = shapeTopScores(
      [
        { player: A, score: 11_480n, highestTile: 1024 },
        { player: B, score: 15_308n, highestTile: 2048 },
        { player: C, score: 15_308n, highestTile: 1024 },
      ],
      ["alice", "", "carol"],
    );
    expect(rows.map((r) => [r.rank, r.player, r.username, r.score])).toEqual([
      [1, B, null, 15_308],
      [2, C, "carol", 15_308],
      [3, A, "alice", 11_480],
    ]);
  });

  it("an all-empty table gives no rows", () => {
    expect(shapeTopScores(Array.from({ length: 10 }, () => ({ player: ZERO, score: 0n, highestTile: 0 })), [])).toEqual([]);
  });
});

// ── /api/analytics/top-scores ────────────────────────────────────────────────
const readContract = vi.fn();
vi.mock("viem", async (orig) => ({
  ...(await orig<typeof import("viem")>()),
  createPublicClient: () => ({ readContract }),
}));

describe("GET /api/analytics/top-scores", () => {
  beforeEach(() => {
    vi.resetModules();
    readContract.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  const load = async () => (await import("../../../app/api/analytics/top-scores/route")).GET;

  it("serves the ranked table with usernames, cacheable at the CDN", async () => {
    readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === "getLeaderboard"
        ? [{ player: A, score: 100n, highestTile: 128 }, { player: ZERO, score: 0n, highestTile: 0 }, { player: B, score: 300n, highestTile: 256 }]
        : ["alice", "bob"],
    );
    const res = await (await load())();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
    const body = await res.json();
    expect(body.stale).toBe(false);
    expect(body.entries.map((e: { username: string }) => e.username)).toEqual(["bob", "alice"]);
    // usernames are requested only for the filled slots
    expect(readContract.mock.calls[1][0].args).toEqual([[A, B]]);
  });

  it("with no good table yet, an RPC failure is a 503, not an empty table", async () => {
    readContract.mockRejectedValue(new Error("rpc down"));
    const res = await (await load())();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("top_scores_unavailable");
  });

  it("after a good read, an RPC failure serves the last table marked stale", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
    readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === "getLeaderboard" ? [{ player: A, score: 100n, highestTile: 128 }] : ["alice"],
    );
    const GET = await load();
    expect((await (await GET()).json()).stale).toBe(false);

    vi.setSystemTime(new Date("2026-11-07T12:02:00Z")); // past the 60 s cache
    readContract.mockRejectedValue(new Error("rpc down"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.stale).toBe(true);
    expect(body.entries[0].username).toBe("alice");
  });
});

describe("/analytics page", () => {
  const page = readFileSync(join(__dirname, "../../../app/analytics/page.tsx"), "utf8");

  it("has no season-rewards section and shows no proposed XP economics", () => {
    // The rewards panel read the undeployed BlockSlideRewards contract and showed unapproved
    // conversion figures; Season 5 rewards are gated separately (docs/SEASON5_RELEASE_READINESS.md).
    expect(page).not.toMatch(/api\/analytics\/rewards|RewardsSection|PROPOSED_RULE|lib\/rewards/);
  });

  it("reads only sources that exist on this branch", () => {
    const urls = [...page.matchAll(/useSource<[^>]+>\("([^"?]+)/g)].map((m) => m[1]);
    expect(urls).toEqual(["/api/stats", "/api/analytics/top-scores", "/api/leaderboard"]);
  });
});
