/**
 * Stats reseed DRY RUN. Calculates the replacement totals and shows exactly where the stored
 * aggregate's hole is, without writing anywhere. docs/runbooks/STATS_RESEED.md is the procedure.
 *
 * What it touches: Blockscout and a public Celo RPC (GET / eth_getLogs only), the public
 * /api/stats response (GET), and local files under --out-dir. It opens no Redis connection and is
 * never given a Redis URL: it works on a SNAPSHOT FILE the authorised operator exports.
 *
 * Run from frontend/ so the imports resolve:
 *   cd frontend
 *   npx vite-node ../scripts/analytics/reseed-dry-run.ts -- [options]
 *
 * Options
 *   --public-url <url>      Where "what is stored now" comes from when there is no snapshot.
 *                           Default https://blockslide.app/api/stats (public GET)
 *   --public-file <path>    A saved public /api/stats response instead of fetching one
 *   --snapshot <path>       The operator's snapshot of stats:v1:state, exact bytes. Enables the merge
 *                           preview, the field-by-field proof and replacement-state.json
 *   --expect <path>         JSON of the totals the replacement must have
 *   --logs-cache <path>     Blockscout cache (default ./reseed-logs-cache.json); a re-run resumes
 *   --blockscout-to <n>     Read Blockscout up to this block (default: the checkpoint minus the safety margin, rounded up to 100,000)
 *   --segments <n>          How many spans Blockscout's range is cut into (default 24; keep it fixed to reuse a cache)
 *   --concurrency <n>       Blockscout spans fetched at once (default 6)
 *   --rpc-urls <a,b>        Public RPC endpoints (default $CELO_RPC_URLS or https://forno.celo.org)
 *   --rpc-verify-gap        Re-read the located hole from RPC and require it to equal Blockscout's
 *   --no-rpc-tail           Skip reading the newest 50,000 blocks from RPC (the log-source gate will then fail)
 *   --out-dir <dir>         Where report.json, gap-logs.json and replacement-state.json go (default ./reseed-out)
 *
 * Exit code: 0 no gate failed, 2 a gate failed, 1 an error.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchAllLogs } from "./lib/blockscout-logs.mjs";
import { GAME_ADDRESS, GENESIS_BLOCK, blockToUnix } from "../../frontend/src/lib/stats/config";
import { parseSnapshot, sortLogs, type GapLog, type Totals } from "../../frontend/src/lib/stats/reseed";
import { planReseed, type PlanReport, type RpcGapCheck } from "../../frontend/src/lib/stats/reseedPlan";
import { compareLogSets, readLogsRange, viemGetLogs } from "../../frontend/src/lib/stats/rpcLogs";
import type { StatsSnapshot, StatsState } from "../../frontend/src/lib/stats/state";

/** Equal to SAFETY_MARGIN in seed-stats.mjs: Blockscout's newest blocks can still be filling in. */
const SAFETY_MARGIN = 50_000;

interface Args {
  publicUrl: string; publicFile?: string; snapshot?: string; expect?: string; logsCache: string; blockscoutTo?: number;
  segments: number; concurrency: number; rpcUrls: string[]; rpcVerifyGap: boolean; rpcTail: boolean; outDir: string; help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    publicUrl: "https://blockslide.app/api/stats", logsCache: "./reseed-logs-cache.json", segments: 24, concurrency: 6,
    rpcUrls: (process.env.CELO_RPC_URLS ?? "https://forno.celo.org").split(",").map((s) => s.trim()).filter(Boolean),
    rpcVerifyGap: false, rpcTail: true, outDir: "./reseed-out", help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === "--") continue;
    else if (k === "--help" || k === "-h") a.help = true;
    else if (k === "--public-url") a.publicUrl = v();
    else if (k === "--public-file") a.publicFile = v();
    else if (k === "--snapshot") a.snapshot = v();
    else if (k === "--expect") a.expect = v();
    else if (k === "--logs-cache") a.logsCache = v();
    else if (k === "--blockscout-to") a.blockscoutTo = Number(v());
    else if (k === "--segments") a.segments = Number(v());
    else if (k === "--concurrency") a.concurrency = Number(v());
    else if (k === "--rpc-urls") a.rpcUrls = v().split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--rpc-verify-gap") a.rpcVerifyGap = true;
    else if (k === "--no-rpc-tail") a.rpcTail = false;
    else if (k === "--out-dir") a.outDir = v();
    else throw new Error(`unknown option ${k} (try --help)`);
  }
  return a;
}

const sha = (algo: "sha1" | "sha256", text: string) => createHash(algo).update(text, "utf8").digest("hex");
const when = (block: number) => new Date(blockToUnix(block) * 1000).toISOString().replace(".000Z", "Z");
const n = (x: number) => x.toLocaleString("en-US");
const pad = (s: string | number, w: number, right = false) => (right ? String(s).padStart(w) : String(s).padEnd(w));

async function main(): Promise<number> {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*\n?/, "").replace(/^ \* ?/gm, "")); return 0; }
  console.log(`DRY RUN. No Redis connection is opened. The only files written are under ${a.outDir}\n`);

  // 1. What is stored now: the operator's snapshot, or the public response.
  let snapshot: StatsState | undefined, snapshotRaw: string | undefined, publicStats: StatsSnapshot | undefined;
  let publicFetchedAt: string | undefined;
  if (a.snapshot) {
    snapshotRaw = readFileSync(a.snapshot, "utf8");
    snapshot = parseSnapshot(snapshotRaw);
  } else if (a.publicFile) {
    publicStats = JSON.parse(readFileSync(a.publicFile, "utf8")) as StatsSnapshot;
  } else {
    const url = `${a.publicUrl}${a.publicUrl.includes("?") ? "&" : "?"}cb=${Date.now()}`; // bypass the CDN's cached copy
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`GET ${a.publicUrl} answered ${res.status}`);
    publicStats = (await res.json()) as StatsSnapshot;
    publicFetchedAt = new Date().toISOString();
  }
  const checkpoint = snapshot ? snapshot.checkpointBlock : publicStats!.checkpointBlock;
  const detailSince = snapshot ? (snapshot.detailSinceBlock ?? null) : (publicStats!.detail.sinceBlock ?? null);
  const expected = a.expect ? (JSON.parse(readFileSync(a.expect, "utf8")) as Totals) : undefined;
  console.log(`stored aggregate : ${snapshot ? `snapshot ${a.snapshot} (${n(snapshotRaw!.length)} bytes)` : `public response${a.publicFile ? ` from ${a.publicFile}` : ` from ${a.publicUrl}`}`}`);
  console.log(`checkpoint block : ${n(checkpoint)} (${when(checkpoint)}); per-day detail from block ${detailSince === null ? "none" : `${n(detailSince)} (${when(detailSince)})`}\n`);

  // 2. Every log up to the checkpoint: Blockscout below the safety horizon, RPC above it.
  const horizon = checkpoint - SAFETY_MARGIN;
  const blockscoutTo = a.blockscoutTo ?? Math.ceil(horizon / 100_000) * 100_000;
  if (blockscoutTo < horizon) throw new Error(`--blockscout-to ${blockscoutTo} is below the safety horizon ${horizon}`);
  console.log(`reading Blockscout, blocks ${n(GENESIS_BLOCK)}-${n(blockscoutTo)} (${a.segments} spans, ${a.concurrency} at a time; cache ${a.logsCache})`);
  const bs = await fetchAllLogs({
    address: GAME_ADDRESS, fromBlock: GENESIS_BLOCK, toBlock: blockscoutTo, concurrency: a.concurrency, segments: a.segments,
    cacheFile: a.logsCache, onProgress: (m: string) => console.log(`  ${m}`),
  });
  const history: GapLog[] = bs.logs.filter((l: GapLog) => l.blockNumber <= horizon);
  console.log(`  ${n(bs.logs.length)} logs from Blockscout (${bs.pages} pages${bs.fromCache ? ", from cache" : ""}); ${n(history.length)} at or below the horizon ${n(horizon)}`);

  let tail: GapLog[] = [];
  let tailFailed = 0;
  if (a.rpcTail) {
    console.log(`reading the newest stretch, blocks ${n(horizon + 1)}-${n(checkpoint)}, from RPC (${a.rpcUrls.join(", ")})`);
    const r = await readLogsRange({ from: horizon + 1, to: checkpoint, getLogs: viemGetLogs(a.rpcUrls), repeats: 3, concurrency: 4 });
    tail = r.logs;
    tailFailed = r.failedChunks.length;
    console.log(`  ${n(tail.length)} logs; chunks where reads disagreed (a flaky node, outvoted by the union): ${r.disagreeingChunks.length}; chunks that failed outright: ${tailFailed}`);
  }
  const logs = sortLogs([...history, ...tail]);
  const coverage = { blockscoutNewest: bs.newestBlock, blockscoutHorizon: horizon, tailFromRpc: a.rpcTail, rpcFailedChunks: tailFailed };

  // 3. Plan; then, if asked, confirm the located hole's logs against RPC and plan again with that result.
  const input = { logs, checkpointBlock: checkpoint, detailSinceBlock: detailSince, snapshot, publicStats, expected, coverage };
  let plan = planReseed(input);
  let rpcGapCheck: RpcGapCheck | null = null;
  if (a.rpcVerifyGap && plan.windows.length && plan.gapLogs) {
    // Each hole separately: read exactly its blocks from RPC and require the same logs, topics and data as Blockscout's.
    const total: RpcGapCheck = { identical: true, onlyBlockscout: 0, onlyRpc: 0, different: 0, failedChunks: 0 };
    let offset = 0;
    for (const [i, w] of plan.windows.entries()) {
      const mine = plan.gapLogs.slice(offset, offset + w.logs);
      offset += w.logs;
      const first = mine[0], last = mine[mine.length - 1];
      console.log(`\nre-reading hole ${i + 1}, blocks ${n(first.blockNumber)}-${n(last.blockNumber)}, from RPC`);
      const r = await readLogsRange({ from: first.blockNumber, to: last.blockNumber, getLogs: viemGetLogs(a.rpcUrls), repeats: 4, concurrency: 4 });
      const within = (l: GapLog) =>
        (l.blockNumber > first.blockNumber || l.logIndex >= first.logIndex) && (l.blockNumber < last.blockNumber || l.logIndex <= last.logIndex);
      const rpc = r.logs.filter(within);
      const cmp = compareLogSets(mine, rpc);
      console.log(`  RPC returned ${rpc.length} logs; Blockscout has ${mine.length}; identical: ${cmp.identical}; chunks where reads disagreed: ${r.disagreeingChunks.length}; failed outright: ${r.failedChunks.length}`);
      total.identical &&= cmp.identical;
      total.onlyBlockscout += cmp.onlyA.length; total.onlyRpc += cmp.onlyB.length; total.different += cmp.different.length; total.failedChunks += r.failedChunks.length;
    }
    rpcGapCheck = total;
    plan = planReseed({ ...input, rpcGapCheck });
  }

  // 4. Report.
  print(plan);
  mkdirSync(a.outDir, { recursive: true });
  const replacementJson = plan.replacementState ? JSON.stringify(plan.replacementState) : undefined;
  const { gapLogs, replacementState, expectedView, ...summary } = plan;
  const inputs = {
    generatedAt: new Date().toISOString(),
    stored: snapshot
      ? { kind: "snapshot", file: a.snapshot, bytes: snapshotRaw!.length, sha1: sha("sha1", snapshotRaw!), sha256: sha("sha256", snapshotRaw!) }
      : { kind: "public", url: a.publicFile ? undefined : a.publicUrl, file: a.publicFile, fetchedAt: publicFetchedAt },
    gapLogs: gapLogs ? { file: "gap-logs.json", count: gapLogs.length, sha256: sha("sha256", JSON.stringify(gapLogs)) } : null,
    replacement: replacementJson ? { file: "replacement-state.json", bytes: replacementJson.length, sha1: sha("sha1", replacementJson), sha256: sha("sha256", replacementJson) } : null,
    logs: { total: logs.length, blockscout: history.length, rpcTail: tail.length, blockscoutNewest: bs.newestBlock, horizon, cache: a.logsCache },
    rpcGapCheck,
  };
  writeFileSync(join(a.outDir, "report.json"), JSON.stringify({ inputs, ...summary }, null, 2));
  if (gapLogs) writeFileSync(join(a.outDir, "gap-logs.json"), JSON.stringify(gapLogs));
  if (replacementJson) writeFileSync(join(a.outDir, "replacement-state.json"), replacementJson);
  writeFileSync(join(a.outDir, "expected-public.json"), JSON.stringify(expectedView));
  console.log(`\nwrote ${join(a.outDir, "report.json")}, expected-public.json${gapLogs ? ", gap-logs.json" : ""}${replacementJson ? ", replacement-state.json" : ""}`);
  console.log("Nothing was written to Redis: no connection was opened.");
  void replacementState;
  return plan.ok ? 0 : 2;
}

function print(p: PlanReport) {
  console.log(`\n=== Dry run result (${p.mode === "snapshot" ? "from the operator's snapshot" : "from the public response only"}) ===`);
  console.log(`${n(p.logsRead)} logs read up to block ${n(p.checkpointBlock)}`);
  if (p.nothingToDo) console.log("\nNo day differs between the stored aggregate and a complete scan: there is nothing to correct.");
  if (p.shortfallDays.length) {
    console.log("\nShortfall by UTC day (complete scan minus stored):");
    for (const d of p.shortfallDays) console.log(`  ${d.day}  stored ${pad(d.current, 4, true)}  complete ${pad(d.reference, 4, true)}  missing ${pad(d.missing, 4, true)}`);
  }
  if (p.windows.length) {
    console.log(`\nThe ${p.windows.length === 1 ? "hole" : `${p.windows.length} holes, in block order`}`);
    p.windows.forEach((w, i) => {
      console.log(`  ${p.windows.length > 1 ? `hole ${i + 1}: ` : ""}${w.days.join(" to ")}`);
      console.log(`    blocks ${n(w.fromBlock)} to ${n(w.toBlock)} (${n(w.toBlock - w.fromBlock + 1)} blocks), ${w.fromTime} to ${w.toTime}`);
      console.log(`    the nearest counted logs are in blocks ${w.lastCountedBefore === null ? "-" : n(w.lastCountedBefore)} and ${w.firstCountedAfter === null ? "-" : n(w.firstCountedAfter)}; a boundary anywhere between is equivalent`);
      console.log(`    ${w.logs} logs: ${Object.entries(w.byEvent).map(([k, v]) => `${k} ${v}`).join(", ")}, other ${w.logs - Object.values(w.byEvent).reduce((s, v) => s + v, 0)}`);
      if (w.equivalentCandidates > 1) console.log(`    ${w.equivalentCandidates} different runs of logs fit this hole equally well (it sits inside one day); they are equivalent in effect`);
    });
    const h = p.holes!;
    console.log(`  together: ${h.logs} logs; they introduce ${h.newWallets} wallet(s) the aggregate has never seen and touch ${h.touchedWallets} in all`);
  }
  console.log("\nTotals");
  console.log(`  ${pad("metric", 17)}${pad("stored now", 13, true)}${pad("replacement", 13, true)}${p.expected ? pad("expected", 11, true) : ""}`);
  for (const r of p.rows) {
    console.log(`  ${pad(r.metric, 17)}${pad(n(r.current), 13, true)}${pad(n(r.replacement), 13, true)}${p.expected ? pad(n(r.expected!), 11, true) : ""}  ${r.expectedOk === false || !r.replacementOk ? "MISMATCH" : r.current !== r.replacement ? "corrected" : "unchanged"}`);
  }
  console.log("\nGates");
  for (const g of p.gates) console.log(`  [${g.status.toUpperCase().padEnd(7)}] ${g.title}\n            ${g.detail}`);
  console.log(`\n${p.ok ? (p.readyToApply ? "READY TO APPLY: every gate passed. An authorised operator applies replacement-state.json as the runbook says." : "NO GATE FAILED" + (p.mode === "public" ? ", but a public response cannot show the untouched fields. Run again with the operator's --snapshot." : ", but some gates were skipped, so this is not ready to apply.")) : "STOP: at least one gate failed. Do not apply anything."}`);
}

main().then((code) => process.exit(code), (err) => { console.error(`\nERROR: ${(err as Error).message}`); process.exit(1); });
