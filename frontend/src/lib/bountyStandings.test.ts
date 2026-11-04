/**
 * Bounties: Bounty 1 keeps its original data, a live bounty shows its current standings, and a
 * completed one shows only its five winners, ranked by XP earned in the window, with no wallet
 * addresses in what the page or the public API receives.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bounties, getBountyStatus } from "../config/bounties";
import { compareStandings, publicStandings, rankStandings, toPublicBounty, type PlayerSnapshot, type StandingRow } from "./bountyStandings";
import { BountyStandings, PastBountyCard } from "../components/BountyPanels";

const ADDR = /0x[0-9a-fA-F]{40}/;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const snap = (rows: Array<[number, number, string | null, number?]>) =>
  new Map<string, PlayerSnapshot>(rows.map(([n, xp, username, firstSeen]) => [addr(n), { id: addr(n), xp: BigInt(xp), username, firstSeen: firstSeen ?? 1000 + n }]));

describe("Bounty 1 keeps its original data", () => {
  it("is the first configured bounty, with its original title, description, dates, prize and criteria", () => {
    const b1 = bounties[0];
    expect(b1).toMatchObject({
      id: "bounty-1",
      title: "BlockSlide Launch Bounty",
      description: "Join the BlockSlide launch celebration! Compete with verified players worldwide to earn top rankings and prizes.",
      startTime: "2026-08-01T11:00:00Z",
      endTime: "2026-08-03T22:59:59Z",
      prizes: "$30 prize pool",
      winnerCriteria: "Top 5 verified players by XP earned during the bounty period",
    });
    expect(b1.howToParticipate).toHaveLength(6);
    expect(bounties.map((b) => b.id)).toEqual(["bounty-1", "bounty-2", "bounty-3"]);
  });

  it("is numbered and listed on the page with the other completed bounties", () => {
    const pub = bounties.map((b, i) => toPublicBounty(b, i, "ended", { phase: "final", winners: [], participants: 0 }));
    expect(pub.map((b) => b.number)).toEqual([1, 2, 3]);
    const html = renderToStaticMarkup(createElement(PastBountyCard, { bounty: pub[0] }));
    expect(html).toContain("Bounty #1");
    expect(html).toContain("BlockSlide Launch Bounty");
    expect(html).toContain("$30 prize pool");
    expect(html).toContain("1 Aug 2026, 11:00 – 3 Aug 2026, 22:59 UTC");
    // The page no longer special-cases or drops any bounty.
    const page = readFileSync(join(__dirname, "../../app/bounty/page.tsx"), "utf8");
    expect(page).not.toMatch(/bounty-1|\.slice\(/);
    expect(page).toContain('all.filter((b) => b.status === "ended" && b.id !== currentBounty.id)');
  });
});

describe("Ranking", () => {
  it("ranks by XP earned inside the window, not total XP", () => {
    const start = snap([[1, 1_000_000, "Whale"], [2, 0, "Newcomer"]]);
    const end = snap([[1, 1_000_500, "Whale"], [2, 9_000, "Newcomer"]]);
    expect(rankStandings(start, end).map((r) => [r.username, r.bountyXp])).toEqual([["Newcomer", 9000n], ["Whale", 500n]]);
  });

  it("leaves out players who earned nothing, and counts a player first seen mid-bounty from zero", () => {
    const rows = rankStandings(snap([[1, 50, "A"]]), snap([[1, 50, "A"], [2, 40, "B"]]));
    expect(rows.map((r) => r.username)).toEqual(["B"]);
  });

  it("breaks ties deterministically: earliest player first, then the lower address (the leaderboard rule)", () => {
    const end = snap([[3, 100, "C", 50], [1, 100, "A", 60], [2, 100, "B", 50]]);
    expect(rankStandings(new Map(), end).map((r) => r.username)).toEqual(["B", "C", "A"]);
    const a: StandingRow = { id: addr(1), username: null, firstSeen: 1, bountyXp: 5n };
    expect(compareStandings(a, { ...a })).toBe(0);
    // Same input in any order gives the same output.
    const shuffled = new Map([...end.entries()].reverse());
    expect(rankStandings(new Map(), shuffled)).toEqual(rankStandings(new Map(), end));
  });

  it("compares XP as BigInt (cumulative XP can exceed 2^53)", () => {
    const big = 2n ** 60n;
    const rows = rankStandings(new Map(), new Map([
      [addr(1), { id: addr(1), xp: big + 1n, username: "A", firstSeen: 1 }],
      [addr(2), { id: addr(2), xp: big + 2n, username: "B", firstSeen: 1 }],
    ]));
    expect(rows.map((r) => r.username)).toEqual(["B", "A"]);
  });
});

const many = (n: number): StandingRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: addr(i + 1), username: i % 4 === 3 ? null : `P${i + 1}`, firstSeen: i, bountyXp: BigInt((n - i) * 100) }));

describe("Public view", () => {
  it("a live bounty shows its current participants with their live XP (top 50)", () => {
    const v = publicStandings("live", many(60));
    expect(v.phase).toBe("live");
    if (v.phase !== "live") return;
    expect(v.entries).toHaveLength(50);
    expect(v.participants).toBe(60);
    expect(v.entries[0]).toEqual({ rank: 1, id: addr(1), username: "P1", xp: "6000" });
  });

  it("a completed bounty shows only the five winners, in XP order, and no addresses", () => {
    const v = publicStandings("ended", many(75));
    expect(v.phase).toBe("final");
    if (v.phase !== "final") return;
    expect(v.winners.map((w) => w.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(v.winners.map((w) => Number(w.xp))).toEqual([7500, 7400, 7300, 7200, 7100]);
    expect(v.participants).toBe(75);
    expect(JSON.stringify(v)).not.toMatch(ADDR);
    expect(v).not.toHaveProperty("entries");
    for (const w of v.winners) expect(Object.keys(w).sort()).toEqual(["displayName", "profile", "rank", "xp"]);
  });

  it("fewer than five participants: every one is a winner, and nothing is padded", () => {
    const v = publicStandings("ended", many(3));
    if (v.phase !== "final") throw new Error("expected final");
    expect(v.winners).toHaveLength(3);
    const html = renderToStaticMarkup(createElement(BountyStandings, { standings: v }));
    expect((html.match(/<li/g) ?? []).length).toBe(3);
    expect(html).toContain("Only 3 verified players earned XP during this bounty.");
    const none = renderToStaticMarkup(createElement(BountyStandings, { standings: publicStandings("ended", []) }));
    expect(none).toContain("there are no winners");
  });

  it("a winner without a username is shown as an unnamed player, with no address and no profile link", () => {
    const v = publicStandings("ended", many(5)); // P4 has no username
    if (v.phase !== "final") throw new Error("expected final");
    expect(v.winners[3]).toEqual({ rank: 4, displayName: null, profile: null, xp: "200" });
    const html = renderToStaticMarkup(createElement(BountyStandings, { standings: v }));
    expect(html).toContain("Unnamed player");
    expect(html).not.toMatch(ADDR);
    expect(html).not.toMatch(/0x0{4,}/); // no shortened address either
    expect(html).toContain('href="/profile/P1"');
    expect((html.match(/href=/g) ?? []).length).toBe(4);
    expect(html).toContain("Winners · Final Standings");
  });

  it("a live bounty's list still links each player by address, as before", () => {
    const html = renderToStaticMarkup(createElement(BountyStandings, { standings: publicStandings("live", many(6)) }));
    expect(html).toContain("Live Standings");
    expect(html).toContain(`href="/profile/${addr(1)}"`);
    expect((html.match(/<li/g) ?? []).length).toBe(6);
  });

  it("upcoming shows nothing; a failed read says so instead of showing an empty list", () => {
    expect(publicStandings("upcoming", many(3))).toEqual({ phase: "upcoming" });
    expect(publicStandings("ended", null)).toEqual({ phase: "unavailable" });
    expect(renderToStaticMarkup(createElement(BountyStandings, { standings: { phase: "unavailable" } }))).toContain("can&#x27;t be loaded");
  });
});

describe("Lifecycle: live to completed", () => {
  it("status follows the end time", () => {
    const b = bounties[2];
    expect(getBountyStatus(b, new Date("2026-08-16T00:00:00Z"))).toBe("upcoming");
    expect(getBountyStatus(b, new Date("2026-08-20T00:00:00Z"))).toBe("live");
    expect(getBountyStatus(b, new Date(b.endTime))).toBe("live"); // the end instant is still live
    expect(getBountyStatus(b, new Date(Date.parse(b.endTime) + 1000))).toBe("ended");
  });

  it("the same standings switch from the live list to five winners once the bounty ends", () => {
    const rows = many(30);
    const live = publicStandings("live", rows), done = publicStandings("ended", rows);
    expect(live.phase === "live" && live.entries.length).toBe(30);
    expect(done.phase === "final" && done.winners.length).toBe(5);
    if (live.phase === "live" && done.phase === "final") expect(done.winners.map((w) => w.xp)).toEqual(live.entries.slice(0, 5).map((e) => e.xp));
  });
});

// ── The public route ─────────────────────────────────────────────────────

const START = 100n, END = 200n;
function fakeSubgraph(byBlock: Record<string, Array<[number, number, string | null]>>) {
  return vi.fn(async (_url: string, init: { body: string }) => {
    const q = JSON.parse(init.body).query as string;
    const block = /block: \{ number: (\d+) \}/.exec(q)?.[1] ?? "latest";
    const after = /id_gt: "([^"]*)"/.exec(q)?.[1] ?? "0x";
    const players = (byBlock[block] ?? []).map(([n, xp, username]) => ({ id: addr(n), xp: String(xp), username, firstSeen: String(1000 + n) }))
      .filter((p) => p.id > after);
    return new Response(JSON.stringify({ data: { players } }), { status: 200 });
  });
}

async function loadRoute(now: string, config: Array<{ id: string; startTime: string; endTime: string }>) {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  process.env.SUBGRAPH_URL = "https://subgraph.test";
  vi.doMock("../config/bounties", async (orig) => {
    const real = (await orig()) as typeof import("../config/bounties");
    return { ...real, bounties: config.map((c, i) => ({ ...real.bounties[0], ...c, title: `Test ${i + 1}` })) };
  });
  vi.doMock("./blockResolver", () => ({
    resolveBlockByTime: async (_c: unknown, d: Date) => (config.some((c) => Date.parse(c.endTime) === d.getTime()) ? END : START),
  }));
  return import("../../app/api/bounties/route");
}

const tenPlayers: Array<[number, number, string | null]> = Array.from({ length: 10 }, (_, i) => [i + 1, (i + 1) * 1000, i === 1 ? null : `U${i + 1}`]);

describe("GET /api/bounties", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock("../config/bounties"); vi.doUnmock("./blockResolver"); delete process.env.SUBGRAPH_URL; });

  it("a completed bounty's response holds only five winners and no wallet addresses", async () => {
    vi.stubGlobal("fetch", fakeSubgraph({ [String(START)]: [], [String(END)]: tenPlayers, latest: tenPlayers }));
    const { GET } = await loadRoute("2026-09-01T00:00:00Z", [{ id: "t1", startTime: "2026-08-01T00:00:00Z", endTime: "2026-08-02T00:00:00Z" }]);
    const raw = await (await GET()).text();
    expect(raw).not.toMatch(ADDR);
    const body = JSON.parse(raw);
    expect(body.bounties[0].standings.phase).toBe("final");
    expect(body.bounties[0].standings.winners.map((w: { displayName: string | null }) => w.displayName)).toEqual(["U10", "U9", "U8", "U7", "U6"]);
    expect(body.bounties[0].standings.participants).toBe(10);
  });

  it("a completed bounty is judged at its end block, not now", async () => {
    // After the end, U1 earns a fortune; it must not change the final result.
    const later: Array<[number, number, string | null]> = [...tenPlayers.slice(1), [1, 99_000_000, "U1"]];
    vi.stubGlobal("fetch", fakeSubgraph({ [String(START)]: [], [String(END)]: tenPlayers, latest: later }));
    const { GET } = await loadRoute("2026-09-01T00:00:00Z", [{ id: "t1", startTime: "2026-08-01T00:00:00Z", endTime: "2026-08-02T00:00:00Z" }]);
    const body = await (await GET()).json();
    expect(body.bounties[0].standings.winners[0]).toMatchObject({ displayName: "U10", xp: "10000" });
  });

  it("a live bounty returns its current participants; after the end time the same route returns five winners", async () => {
    const cfg = [{ id: "t1", startTime: "2026-08-01T00:00:00Z", endTime: "2026-08-10T00:00:00Z" }];
    vi.stubGlobal("fetch", fakeSubgraph({ [String(START)]: [], [String(END)]: tenPlayers, latest: tenPlayers }));
    let { GET } = await loadRoute("2026-08-05T00:00:00Z", cfg);
    let body = await (await GET()).json();
    expect(body.bounties[0].status).toBe("live");
    expect(body.bounties[0].standings.entries).toHaveLength(10);
    expect(body.bounties[0].standings.entries[0]).toMatchObject({ rank: 1, username: "U10", xp: "10000" });

    ({ GET } = await loadRoute("2026-08-10T00:00:01Z", cfg));
    body = await (await GET()).json();
    expect(body.bounties[0].status).toBe("ended");
    expect(body.bounties[0].standings.winners).toHaveLength(5);
    expect(body.bounties[0].standings).not.toHaveProperty("entries");
  });

  it("all completed bounties get the same treatment, and a subgraph failure is reported, not hidden", async () => {
    const cfg = [1, 2, 3].map((n) => ({ id: `t${n}`, startTime: `2026-0${n}-01T00:00:00Z`, endTime: `2026-0${n}-02T00:00:00Z` }));
    vi.stubGlobal("fetch", fakeSubgraph({ [String(START)]: [], [String(END)]: tenPlayers }));
    let { GET } = await loadRoute("2026-09-01T00:00:00Z", cfg);
    const body = await (await GET()).json();
    expect(body.bounties.map((b: { number: number }) => b.number)).toEqual([1, 2, 3]);
    for (const b of body.bounties) expect(b.standings.winners).toHaveLength(5);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 502 })));
    ({ GET } = await loadRoute("2026-09-01T00:00:00Z", cfg));
    const failed = await (await GET()).json();
    for (const b of failed.bounties) expect(b.standings).toEqual({ phase: "unavailable" });
  });
});
