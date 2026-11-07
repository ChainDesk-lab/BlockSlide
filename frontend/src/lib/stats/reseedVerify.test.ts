/** Post-reseed verification of /api/stats, on the synthetic history. */
import { describe, expect, it } from "vitest";
import { derive } from "./state";
import { buildState } from "./reseed";
import { verifyStats, visibleNumbers } from "./reseedVerify";
import { CP, D, FIXED_AT, SEL, blockAt, mk, world } from "./reseedTestWorld";

const failed = (r: ReturnType<typeof verifyStats>) => r.checks.filter((c) => !c.ok).map((c) => c.id);

describe("verifyStats", () => {
  it("passes strictly when the live response is the expected view", () => {
    const { complete } = world();
    const r = verifyStats(derive(complete), derive(complete), { strict: true });
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.id)).toContain("whole-response");
  });

  it("fails on the state BEFORE the reseed, and says where", () => {
    const { stored, complete } = world();
    const r = verifyStats(derive(stored), derive(complete));
    expect(r.ok).toBe(false);
    expect(failed(r)).toEqual(expect.arrayContaining(["totals", "history-daily", "history-weekly", "funnel"]));
    expect(r.checks.find((c) => c.id === "history-daily")!.detail).toMatch(/2026-09-2[234]/);
    expect(r.checks.find((c) => c.id === "totals")!.detail).toMatch(/playerWallets/);
  });

  it("still passes after the app has scanned further: history is final, totals only go up", () => {
    const { all, complete } = world();
    const later = buildState(
      [...all, mk(SEL.session, 1, CP + 5_000, 9), mk(SEL.username, 9, CP + 6_000, 9)],
      { checkpointBlock: CP + 50_000, detailSinceBlock: D, updatedAt: FIXED_AT },
    );
    expect(verifyStats(derive(later), derive(complete)).ok).toBe(true);
    const strict = verifyStats(derive(later), derive(complete), { strict: true });
    expect(strict.ok).toBe(false);
    expect(failed(strict)).toContain("checkpoint");
  });

  it("fails if the corrected state was overwritten by the old one after the app had moved on", () => {
    const { stored, complete } = world();
    const oldPlusNew = buildState(
      [...world().rest, mk(SEL.session, 1, CP + 5_000, 9)],
      { checkpointBlock: CP + 50_000, detailSinceBlock: D, updatedAt: FIXED_AT },
    );
    const r = verifyStats(derive(oldPlusNew), derive(complete));
    expect(r.ok).toBe(false);
    expect(failed(r)).toContain("history-daily");
    expect(stored.totalLogs).toBeLessThan(complete.totalLogs);
  });

  it("fails if the per-day detail was disturbed", () => {
    const { complete } = world();
    const tampered = structuredClone(derive(complete));
    tampered.detail.days[0] = { ...tampered.detail.days[0], sessions: tampered.detail.days[0].sessions + 1 };
    expect(failed(verifyStats(tampered, derive(complete)))).toContain("detail-untouched");
    const moved = { ...structuredClone(derive(complete)), detail: { ...derive(complete).detail, sinceBlock: D + 1 } };
    expect(failed(verifyStats(moved, derive(complete)))).toContain("detail-untouched");
  });

  it("fails if a total went down", () => {
    const { complete } = world();
    const v = structuredClone(derive(complete));
    v.checkpointBlock += 100;
    v.totals.logs -= 1;
    expect(failed(verifyStats(v, derive(complete)))).toContain("totals");
  });

  it("the current day and week may differ; only history is compared", () => {
    const { complete } = world();
    const v = structuredClone(derive(complete));
    v.checkpointBlock += 1_000;
    v.daily[v.daily.length - 1] = { ...v.daily[v.daily.length - 1], events: v.daily[v.daily.length - 1].events + 3 };
    v.totals.logs += 3;
    expect(verifyStats(v, derive(complete)).ok).toBe(true);
    expect(blockAt("2026-11-06", 23)).toBe(CP);
  });
});

describe("visibleNumbers", () => {
  it("formats what a visitor should see, with thousands separators", () => {
    const { complete } = world();
    const v = { ...derive(complete), playerWallets: 1707, gDollarPaid: 12_345 };
    const nums = visibleNumbers(v);
    expect(nums.find((x) => x.label === "Player wallets")!.text).toBe("1,707");
    expect(nums.find((x) => x.label === "G$ paid to players")!.text).toBe("12,345");
  });
});
