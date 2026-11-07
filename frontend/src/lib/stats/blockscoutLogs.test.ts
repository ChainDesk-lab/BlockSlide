/**
 * The Blockscout log collector used by the stats reseed dry run, against a fake server that
 * behaves like the v2 API: newest first, 50 per page, a positional "strictly before" cursor.
 * No network.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchAllLogs, normaliseLog, planSegments, waitFromHeaders } from "../../../../scripts/analytics/lib/blockscout-logs.mjs";

const ADDRESS = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "blockscout-logs-")); dirs.push(d); return join(d, "cache.json"); };
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

interface Fake { block: number; index: number }

function fakeServer(logs: Fake[], opts: { pageSize?: number; limitFirst?: number; failAfter?: number } = {}) {
  const pageSize = opts.pageSize ?? 50;
  const newestFirst = [...logs].sort((a, b) => b.block - a.block || b.index - a.index);
  const state = { calls: 0, limited: 0 };
  const fetchImpl = (async (url: string) => {
    state.calls += 1;
    if (opts.failAfter !== undefined && state.calls > opts.failAfter) return new Response("boom", { status: 500 });
    if (state.limited < (opts.limitFirst ?? 0)) {
      state.limited += 1;
      return new Response("slow down", { status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000" } });
    }
    const q = new URL(url).searchParams;
    const cb = q.get("block_number");
    let rest = newestFirst;
    if (cb !== null) {
      const ci = Number(q.get("index") ?? 0);
      rest = newestFirst.filter((l) => l.block < Number(cb) || (l.block === Number(cb) && l.index < ci));
    }
    const page = rest.slice(0, pageSize);
    const last = page[page.length - 1];
    return new Response(JSON.stringify({
      items: page.map((l) => ({ block_number: l.block, index: l.index, topics: ["0xaa", null, null, null], data: "0x01", transaction_hash: "0x" + l.block.toString(16) })),
      next_page_params: rest.length > pageSize ? { index: last.index, block_number: last.block } : null,
    }), { status: 200, headers: { "x-ratelimit-remaining": "100", "x-ratelimit-reset": "1000" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, state };
}

const noSleep = async () => {};
const FROM = 1_000;
const TO = 20_999;

/** Logs spread across the range, plus some placed exactly on every segment boundary. */
function population(segments: number): Fake[] {
  const out: Fake[] = [];
  for (let b = FROM; b <= TO; b += 37) out.push({ block: b, index: 0 }, { block: b, index: 1 });
  for (const s of planSegments(FROM, TO, segments)) out.push({ block: s.top, index: 7 }, { block: s.bottom, index: 8 });
  const seen = new Set<string>();
  return out.filter((l) => !seen.has(`${l.block}:${l.index}`) && seen.add(`${l.block}:${l.index}`));
}
const keys = (ls: Array<{ blockNumber: number; logIndex: number }>) => ls.map((l) => `${l.blockNumber}:${l.logIndex}`);

describe("planSegments", () => {
  it("covers the range exactly once, newest first", () => {
    const segs = planSegments(FROM, TO, 7);
    expect(segs[0].top).toBe(TO);
    expect(segs[segs.length - 1].bottom).toBe(FROM);
    for (let i = 1; i < segs.length; i++) expect(segs[i].top).toBe(segs[i - 1].bottom - 1);
    expect(segs.reduce((n, s) => n + (s.top - s.bottom + 1), 0)).toBe(TO - FROM + 1);
  });
  it("a range smaller than the segment count still works", () => {
    expect(planSegments(5, 7, 24).reduce((n, s) => n + (s.top - s.bottom + 1), 0)).toBe(3);
  });
});

describe("fetchAllLogs", () => {
  it("returns every log exactly once, in chain order, with segments fetched concurrently", async () => {
    const pop = population(8);
    const { fetchImpl } = fakeServer(pop);
    const r = await fetchAllLogs({ address: ADDRESS, fromBlock: FROM, toBlock: TO, concurrency: 4, segments: 8, fetchImpl, sleep: noSleep });
    const want = [...pop].sort((a, b) => a.block - b.block || a.index - b.index).map((l) => `${l.block}:${l.index}`);
    expect(keys(r.logs)).toEqual(want);
    expect(r.newestBlock).toBe(Math.max(...pop.map((l) => l.block)));
  });

  it("gives the same answer with one segment as with many", async () => {
    const pop = population(8);
    const one = await fetchAllLogs({ address: ADDRESS, fromBlock: FROM, toBlock: TO, concurrency: 1, segments: 1, fetchImpl: fakeServer(pop).fetchImpl, sleep: noSleep });
    const many = await fetchAllLogs({ address: ADDRESS, fromBlock: FROM, toBlock: TO, concurrency: 6, segments: 13, fetchImpl: fakeServer(pop).fetchImpl, sleep: noSleep });
    expect(keys(one.logs)).toEqual(keys(many.logs));
  });

  it("ignores logs outside the requested range", async () => {
    const pop = [...population(4), { block: FROM - 5, index: 0 }, { block: TO + 5, index: 0 }];
    const r = await fetchAllLogs({ address: ADDRESS, fromBlock: FROM, toBlock: TO, segments: 4, fetchImpl: fakeServer(pop).fetchImpl, sleep: noSleep });
    expect(r.logs.every((l) => l.blockNumber >= FROM && l.blockNumber <= TO)).toBe(true);
  });

  it("keeps a block's logs together when they span a page boundary", async () => {
    const pop = Array.from({ length: 12 }, (_, i) => ({ block: 5_000, index: i }));
    const r = await fetchAllLogs({ address: ADDRESS, fromBlock: FROM, toBlock: TO, segments: 3, fetchImpl: fakeServer(pop, { pageSize: 5 }).fetchImpl, sleep: noSleep });
    expect(r.logs).toHaveLength(12);
  });

  it("pauses everyone on a 429 and then carries on", async () => {
    const pop = population(4);
    const sleeps: number[] = [];
    const { fetchImpl, state } = fakeServer(pop, { limitFirst: 2 });
    const r = await fetchAllLogs({ address: ADDRESS, fromBlock: FROM, toBlock: TO, concurrency: 3, segments: 4, fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
    expect(r.logs).toHaveLength(pop.length);
    expect(state.limited).toBe(2);
    expect(sleeps.some((ms) => ms >= 2500)).toBe(true); // waited out the window the server reported
  });

  it("normalises logs: null topics dropped, missing data becomes 0x", () => {
    expect(normaliseLog({ block_number: "12", index: "3", topics: ["0xaa", null, "0xbb", null], data: null, transaction_hash: "0xtx" }))
      .toEqual({ blockNumber: 12, logIndex: 3, topics: ["0xaa", "0xbb"], data: "0x", transactionHash: "0xtx" });
  });
});

describe("resuming and caching", () => {
  it("an interrupted run resumes without refetching finished segments", async () => {
    const pop = population(8);
    const cacheFile = tmp();
    const fresh = fakeServer(pop);
    await fetchAllLogs({ address: ADDRESS, fromBlock: FROM, toBlock: TO, concurrency: 1, segments: 8, fetchImpl: fresh.fetchImpl, sleep: noSleep });
    const freshCalls = fresh.state.calls;

    const broken = fakeServer(pop, { failAfter: Math.floor(freshCalls / 2) });
    await expect(fetchAllLogs({ address: ADDRESS, fromBlock: FROM, toBlock: TO, concurrency: 1, segments: 8, cacheFile, fetchImpl: broken.fetchImpl, sleep: noSleep }))
      .rejects.toThrow(/Progress is saved/);
    expect(existsSync(cacheFile)).toBe(true);

    const good = fakeServer(pop);
    const r = await fetchAllLogs({ address: ADDRESS, fromBlock: FROM, toBlock: TO, concurrency: 1, segments: 8, cacheFile, fetchImpl: good.fetchImpl, sleep: noSleep });
    expect(keys(r.logs)).toEqual(keys([...pop].sort((a, b) => a.block - b.block || a.index - b.index).map((l) => ({ blockNumber: l.block, logIndex: l.index }))));
    expect(good.state.calls).toBeLessThan(freshCalls); // the first half was not fetched again
  });

  it("a complete cache is used without touching the network", async () => {
    const pop = population(4);
    const cacheFile = tmp();
    await fetchAllLogs({ address: ADDRESS, fromBlock: FROM, toBlock: TO, segments: 4, cacheFile, fetchImpl: fakeServer(pop).fetchImpl, sleep: noSleep });
    const never = (async () => { throw new Error("network used"); }) as unknown as typeof fetch;
    const r = await fetchAllLogs({ address: ADDRESS, fromBlock: FROM, toBlock: TO, segments: 4, cacheFile, fetchImpl: never, sleep: noSleep });
    expect(r.fromCache).toBe(true);
    expect(r.logs).toHaveLength(pop.length);
  });

  it("a cache made for another range is ignored, not trusted", async () => {
    const pop = population(4);
    const cacheFile = tmp();
    await fetchAllLogs({ address: ADDRESS, fromBlock: FROM, toBlock: TO - 5_000, segments: 4, cacheFile, fetchImpl: fakeServer(pop).fetchImpl, sleep: noSleep });
    const r = await fetchAllLogs({ address: ADDRESS, fromBlock: FROM, toBlock: TO, segments: 4, cacheFile, fetchImpl: fakeServer(pop).fetchImpl, sleep: noSleep });
    expect(r.fromCache).toBe(false);
    expect(r.logs).toHaveLength(pop.length);
  });
});

describe("waitFromHeaders", () => {
  it("waits out the window only when it is nearly used up", () => {
    expect(waitFromHeaders(100, 30_000)).toBe(0);
    expect(waitFromHeaders(2, 30_000)).toBe(30_500);
    expect(waitFromHeaders(0, 999_999)).toBe(120_000); // capped
    expect(waitFromHeaders(Number.NaN, 5)).toBe(0);
  });
});
