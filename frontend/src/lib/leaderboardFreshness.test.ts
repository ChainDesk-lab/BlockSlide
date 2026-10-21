import { describe, expect, it } from "vitest";
import {
  assessFreshness,
  DEFAULT_MAX_LAG_BLOCKS,
  freshnessNotice,
  maxLagBlocksFromEnv,
  shouldReplaceLastGood,
} from "./leaderboardFreshness";

const ok = { configured: true, complete: true, hasIndexingErrors: false, maxLagBlocks: 600 };

describe("assessFreshness", () => {
  it("is fresh when the subgraph is within the lag limit", () => {
    const f = assessFreshness({ ...ok, indexedBlock: 1_000, headBlock: 1_600 });
    expect(f).toMatchObject({ stale: false, reason: null, lagBlocks: 600 });
  });

  it("is stale once the lag exceeds the limit", () => {
    const f = assessFreshness({ ...ok, indexedBlock: 1_000, headBlock: 1_601 });
    expect(f).toMatchObject({ stale: true, reason: "indexing_lag", lagBlocks: 601 });
  });

  it("catches a subgraph frozen for days even though it reports no errors (the September case)", () => {
    const f = assessFreshness({ ...ok, indexedBlock: 76_000_000, headBlock: 77_036_800 });
    expect(f.stale).toBe(true);
    expect(f.reason).toBe("indexing_lag");
  });

  it("reports lag as unknown, not stale, when the chain head can't be read", () => {
    const f = assessFreshness({ ...ok, indexedBlock: 1_000, headBlock: null });
    expect(f).toMatchObject({ stale: false, reason: null, lagBlocks: null, headBlock: null });
  });

  it("is stale when the subgraph reports indexing errors", () => {
    expect(assessFreshness({ ...ok, hasIndexingErrors: true, indexedBlock: 1, headBlock: 1 }).reason).toBe("indexing_errors");
  });

  it("is stale when the fetch failed or the subgraph isn't configured", () => {
    expect(assessFreshness({ ...ok, complete: false, indexedBlock: null, headBlock: 5 }).reason).toBe("subgraph_unavailable");
    expect(assessFreshness({ ...ok, configured: false, indexedBlock: null, headBlock: 5 }).reason).toBe("subgraph_unconfigured");
  });
});

describe("maxLagBlocksFromEnv", () => {
  it("defaults to 600 blocks and accepts a positive override", () => {
    expect(maxLagBlocksFromEnv(undefined)).toBe(DEFAULT_MAX_LAG_BLOCKS);
    expect(DEFAULT_MAX_LAG_BLOCKS).toBe(600);
    expect(maxLagBlocksFromEnv("1800")).toBe(1800);
  });
  it("ignores invalid values", () => {
    for (const bad of ["", "0", "-5", "abc"]) expect(maxLagBlocksFromEnv(bad)).toBe(600);
  });
});

describe("freshnessNotice", () => {
  const now = 1_000_000_000_000;
  it("shows nothing for current data", () => {
    expect(freshnessNotice({ stale: false, servedFrom: "live" }, now)).toBeNull();
  });
  it("states the lag in minutes", () => {
    expect(freshnessNotice({ stale: true, freshness: { reason: "indexing_lag", lagBlocks: 1_800 } }, now)).toBe(
      "Rankings are about 30 min behind the chain — recent games may not show yet.",
    );
  });
  it("says when a last-known-good leaderboard is being shown, and how old it is", () => {
    expect(freshnessNotice({ stale: true, servedFrom: "last_known_good", builtAt: now - 5 * 60_000 }, now)).toBe(
      "Live rankings are unavailable right now. Showing the last update from 5 min ago.",
    );
  });
});

describe("shouldReplaceLastGood", () => {
  it("accepts the first build that has players", () => {
    expect(shouldReplaceLastGood({ subgraphPlayers: 5, indexedBlock: 10 }, null)).toBe(true);
  });
  it("rejects an empty build", () => {
    expect(shouldReplaceLastGood({ subgraphPlayers: 0, indexedBlock: 99 }, null)).toBe(false);
  });
  it("rejects a build indexed less far, or with an unknown block, than the saved one", () => {
    const prev = { subgraphPlayers: 600, indexedBlock: 1_000 };
    expect(shouldReplaceLastGood({ subgraphPlayers: 600, indexedBlock: 999 }, prev)).toBe(false);
    expect(shouldReplaceLastGood({ subgraphPlayers: 600, indexedBlock: null }, prev)).toBe(false);
    expect(shouldReplaceLastGood({ subgraphPlayers: 601, indexedBlock: 1_000 }, prev)).toBe(true);
  });
});
