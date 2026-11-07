/**
 * Reads every log a contract has emitted from Blockscout's archive index (the v2 API), politely.
 *
 * This is the same source scripts/analytics/seed-stats.mjs seeds from. Differences that matter for
 * a re-check:
 *  - Pages are slow (13-24 s each at the time of writing), and the cursor is positional ("strictly
 *    before block X"), so the block range is cut into segments that are fetched concurrently.
 *  - A shared gate honours Blockscout's rate-limit headers (180 requests per window) and pauses
 *    every worker on a 429.
 *  - Progress is saved, so an interrupted run resumes instead of starting over.
 *
 * Read-only: it only issues GET requests to Blockscout and writes the optional cache file.
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";

const BASE = "https://celo.blockscout.com/api/v2/addresses";
const DEFAULT_SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const CACHE_VERSION = 2;

/** Normalise one v2 log item. `topics` may contain nulls for unused slots; they are dropped. */
export function normaliseLog(item) {
  return {
    blockNumber: Number(item.block_number),
    logIndex: Number(item.index),
    topics: (item.topics ?? []).filter((t) => typeof t === "string"),
    data: typeof item.data === "string" ? item.data : "0x",
    transactionHash: item.transaction_hash ?? null,
  };
}

/** Cut [fromBlock, toBlock] into `count` roughly equal spans, newest first. Both ends inclusive. */
export function planSegments(fromBlock, toBlock, count) {
  const span = Math.max(1, Math.ceil((toBlock - fromBlock + 1) / count));
  const segments = [];
  for (let top = toBlock; top >= fromBlock; top -= span) {
    // The cursor means "strictly before (block, index)", so (top + 1, 0) starts with every log in `top`.
    // It is set up front so a segment whose very first request fails resumes from the start, not as "finished".
    segments.push({ top, bottom: Math.max(fromBlock, top - span + 1), cursor: { block_number: top + 1, index: 0 }, done: false, pages: 0, logs: [] });
  }
  return segments;
}

/** Milliseconds to pause from Blockscout's rate-limit headers: wait out the window when nearly used up. */
export function waitFromHeaders(remaining, resetMs, { reserve = 5, cap = 120_000 } = {}) {
  if (!Number.isFinite(remaining) || !Number.isFinite(resetMs)) return 0;
  if (remaining > reserve) return 0;
  return Math.min(Math.max(resetMs, 0) + 500, cap);
}

/**
 * @param {object} o
 * @param {string} o.address
 * @param {number} o.fromBlock          first block to read (inclusive)
 * @param {number} o.toBlock            last block to read (inclusive)
 * @param {number} [o.concurrency=6]    segments fetched at once
 * @param {number} [o.segments=24]      how many spans the range is cut into
 * @param {string} [o.cacheFile]        JSON file: used to resume, or returned as is when complete
 * @param {(msg: string) => void} [o.onProgress]
 * @param {typeof fetch} [o.fetchImpl]
 * @param {(ms: number) => Promise<void>} [o.sleep]
 * @returns {Promise<{ logs: Array<ReturnType<typeof normaliseLog>>, pages: number, newestBlock: number, fromCache: boolean }>}
 */
export async function fetchAllLogs({ address, fromBlock, toBlock, concurrency = 6, segments: segmentCount = 24, cacheFile, onProgress = () => {}, fetchImpl = fetch, sleep = DEFAULT_SLEEP }) {
  if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock) || fromBlock > toBlock) throw new Error("fetchAllLogs needs integer fromBlock <= toBlock");
  let plan = planSegments(fromBlock, toBlock, segmentCount);
  let resumed = false;

  if (cacheFile && existsSync(cacheFile)) {
    const saved = JSON.parse(readFileSync(cacheFile, "utf8"));
    const same = saved.version === CACHE_VERSION && saved.address === address && saved.fromBlock === fromBlock && saved.toBlock === toBlock
      && Array.isArray(saved.segments) && saved.segments.length === plan.length;
    if (same) { plan = saved.segments; resumed = true; }
    else onProgress(`ignoring ${cacheFile}: it was made for a different address, range or segment plan`);
  }

  let pages = plan.reduce((n, s) => n + s.pages, 0);
  const pagesAtStart = pages;
  const save = () => {
    if (!cacheFile) return;
    const tmp = cacheFile + ".tmp";
    writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, address, fromBlock, toBlock, segments: plan }));
    renameSync(tmp, cacheFile);
  };

  // One gate for every worker: a rate-limit signal from any response pauses them all.
  let pausedUntil = 0;
  const gate = async () => { const ms = pausedUntil - Date.now(); if (ms > 0) await sleep(ms); };
  const pause = (ms) => { pausedUntil = Math.max(pausedUntil, Date.now() + ms); };

  async function get(params) {
    const url = `${BASE}/${address}/logs${params ? "?" + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])) : ""}`;
    let backoff = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      await gate();
      if (backoff) { await sleep(backoff); backoff = 0; }
      try {
        const res = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "blockslide-stats-reseed-dry-run" } });
        const remaining = Number(res.headers.get("x-ratelimit-remaining"));
        const resetMs = Number(res.headers.get("x-ratelimit-reset"));
        if (res.status === 429) {
          const ms = waitFromHeaders(0, resetMs) || 30_000;
          onProgress(`rate limited; every worker pauses ${Math.round(ms / 1000)}s`);
          pause(ms);
          continue;
        }
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        const ms = waitFromHeaders(remaining, resetMs);
        if (ms) { onProgress(`rate-limit window nearly used (${remaining} left); pausing ${Math.round(ms / 1000)}s`); pause(ms); }
        return json;
      } catch (err) {
        if (attempt === 11) throw new Error(`Blockscout read failed after retries: ${err.message}. Progress is saved; re-run to resume.`);
        backoff = Math.min(500 * 2 ** attempt, 30_000);
      }
    }
    throw new Error("unreachable");
  }

  async function runSegment(seg) {
    let params = seg.cursor;
    while (params) {
      const json = await get(params);
      const items = json.items ?? [];
      for (const item of items) {
        const l = normaliseLog(item);
        if (l.blockNumber >= seg.bottom && l.blockNumber <= seg.top) seg.logs.push(l);
      }
      const lowest = items.length ? Number(items[items.length - 1].block_number) : -Infinity;
      params = json.next_page_params ?? null;
      if (params && lowest < seg.bottom) params = null; // walked past the bottom of this segment
      seg.cursor = params;
      seg.pages += 1;
      pages += 1;
      if ((pages - pagesAtStart) % 10 === 0) { onProgress(`${pages} pages`); save(); }
    }
    seg.done = true;
    save();
  }

  const queue = plan.filter((s) => !s.done);
  if (resumed && queue.length === 0) onProgress(`using the complete cache ${cacheFile}`);
  let failure = null;
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (!failure) {
      const seg = queue.shift();
      if (!seg) return;
      try { await runSegment(seg); } catch (err) { failure = err; }
    }
  }));
  if (failure) { save(); throw failure; }

  // De-duplicate by (block, logIndex), then order the way the chain did.
  const seen = new Map();
  for (const s of plan) for (const l of s.logs) seen.set(`${l.blockNumber}:${l.logIndex}`, l);
  const logs = [...seen.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  return { logs, pages, newestBlock: logs.length ? logs[logs.length - 1].blockNumber : 0, fromCache: resumed && pages === pagesAtStart };
}
