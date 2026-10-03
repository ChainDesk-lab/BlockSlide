/**
 * Production health check for BlockSlide. Read-only, safe to run anytime.
 *
 *   node scripts/check-production.mjs
 *   SITE=http://localhost:3000 node scripts/check-production.mjs   # test locally
 *
 * Validates the things that have actually broken before:
 *   1. leaderboard API reachable, not serving stale data
 *   2. tier ordering is correct and monotonic ACROSS pages (not just page 1)
 *   3. pagination has no duplicate or missing players
 *   4. indexer is tracking chain head (the 12-day XP freeze)
 *   5. XP on the board matches on-chain XP
 *   6. /profile/<user> renders instead of crashing
 */
const SITE = process.env.SITE ?? "https://blockslide.app";
const FORNO = "https://forno.celo.org";
const GAME = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  PASS  ${m}`); pass++; };
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

async function rpc(method, params = []) {
  const r = await fetch(FORNO, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
}

console.log(`checking ${SITE}\n`);

// ---- 1. leaderboard reachable ------------------------------------------------
console.log("1. leaderboard API");
let first;
try {
  const r = await fetch(`${SITE}/api/leaderboard?page=0`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  first = await r.json();
  ok(`reachable — ${first.totalPlayers} players, ${first.totalPages} pages`);
  first.stale ? bad("API reports stale:true") : ok("stale:false");
  const d = first.diagnostics ?? {};
  console.log(`        subgraph=${d.subgraphPlayers} registry=${d.registryPlayers} merged=${d.mergedTotal} block=${d.subgraphBlock}`);
  d.hasIndexingErrors ? bad("subgraph reports indexing errors") : ok("no indexing errors");
} catch (e) { bad(`unreachable: ${e.message}`); }

// ---- 2/3. ordering + pagination integrity -----------------------------------
if (first) {
  console.log("\n2. tier ordering + pagination integrity (all pages)");
  const all = [];
  for (let p = 0; p < first.totalPages; p++) {
    const r = await fetch(`${SITE}/api/leaderboard?page=${p}`);
    const j = await r.json();
    all.push(...(j.entries ?? []));
  }
  ok(`walked ${first.totalPages} pages, ${all.length} rows`);

  const ids = all.map((e) => e.id.toLowerCase());
  const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
  dupes.length ? bad(`${dupes.length} duplicate rows across pages`) : ok("no duplicates across pages");
  all.length === first.totalPlayers
    ? ok(`row count matches totalPlayers (${first.totalPlayers})`)
    : bad(`row count ${all.length} != totalPlayers ${first.totalPlayers}`);

  const tier = (e) => (e.isVerified ? 0 : Number(e.xp) > 0 ? 1 : 2);
  let orderErr = 0, xpErr = 0;
  for (let i = 1; i < all.length; i++) {
    const [a, b] = [all[i - 1], all[i]];
    if (tier(b) < tier(a)) orderErr++;
    if (tier(a) === tier(b) && tier(a) < 2 && Number(b.xp) > Number(a.xp)) xpErr++;
  }
  orderErr ? bad(`${orderErr} tier-order violations`) : ok("tiers monotonic across the whole board");
  xpErr ? bad(`${xpErr} XP-order violations within a tier`) : ok("XP descending within each tier");
  const counts = [0, 0, 0]; all.forEach((e) => counts[tier(e)]++);
  console.log(`        verified=${counts[0]}  played-unverified=${counts[1]}  no-xp=${counts[2]}`);
}

// ---- 4. indexer freshness ----------------------------------------------------
console.log("\n4. indexer freshness");
try {
  const head = parseInt(await rpc("eth_blockNumber"), 16);
  const sgBlock = first?.diagnostics?.subgraphBlock;
  if (sgBlock) {
    const lagBlocks = head - sgBlock;
    const lagMin = lagBlocks / 60; // Celo produces ~1 block/sec
    // 2h matches the leaderboard's own staleness banner. Tens of minutes is
    // ordinary indexer lag; the failure we care about is the 12-day freeze.
    if (lagMin < 120) ok(`indexer ${lagBlocks} blocks behind head (~${lagMin.toFixed(0)} min) — within tolerance`);
    else bad(`indexer ${lagBlocks} blocks behind (~${(lagMin / 60).toFixed(1)} h) — XP will look frozen`);
  } else bad("no subgraphBlock in diagnostics");
} catch (e) { bad(`chain head check failed: ${e.message}`); }

// ---- 5. XP matches chain -----------------------------------------------------
console.log("\n5. board XP vs on-chain XP");
try {
  const head = parseInt(await rpc("eth_blockNumber"), 16);
  const XP_TOPIC = "0xcbe358bf96be0aa0d8a2b0c4d8a0e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5"; // placeholder, filtered below
  // scan a recent window for XpEarned and compare cumulative total to the board
  // Walk back in 5000-block windows — the provider cap. A single wide range
  // returns nothing at all, which is the bug this script exists to catch.
  const xpSig = "0xcbe358bf96be"; // XpEarned(address,uint256,uint256) topic0 prefix
  const recent = [];
  for (let w = 0; w < 60 && recent.length === 0; w++) {
    const to = head - w * 5000;
    const fromB = to - 4999;
    if (fromB <= 0) break;
    const logs = await rpc("eth_getLogs", [{
      address: GAME,
      fromBlock: "0x" + fromB.toString(16),
      toBlock: "0x" + to.toString(16),
    }]);
    for (const l of logs ?? []) if (l.topics[0].startsWith(xpSig)) recent.push(l);
  }
  if (!recent.length) { console.log("        no XpEarned found in the last ~300k blocks; skipping"); }
  else {
    const last = recent[recent.length - 1];
    const addr = "0x" + last.topics[1].slice(26);
    const chainTotal = BigInt("0x" + last.data.slice(66, 130)).toString();
    const r = await fetch(`${SITE}/api/leaderboard?page=0`);
    const j = await r.json();
    let row = null;
    for (let p = 0; p < j.totalPages && !row; p++) {
      const pg = await (await fetch(`${SITE}/api/leaderboard?page=${p}`)).json();
      row = (pg.entries ?? []).find((e) => e.id.toLowerCase() === addr.toLowerCase());
    }
    if (!row) bad(`${addr.slice(0, 10)} earned XP on-chain but is missing from the board`);
    else row.xp === chainTotal
      ? ok(`${(row.username || addr.slice(0, 10))}: board XP ${row.xp} == chain ${chainTotal}`)
      : bad(`${(row.username || addr.slice(0, 10))}: board XP ${row.xp} != chain ${chainTotal}`);
  }
} catch (e) { bad(`XP comparison failed: ${e.message}`); }

// ---- 6. profile route --------------------------------------------------------
console.log("\n6. profile route");
try {
  const name = first?.entries?.[0]?.username;
  if (!name) { console.log("        no username to test"); }
  else {
    const r = await fetch(`${SITE}/profile/${encodeURIComponent(name)}`);
    const html = await r.text();
    r.ok && !/Application error/i.test(html)
      ? ok(`/profile/${name} served HTTP ${r.status}, no server-rendered error`)
      : bad(`/profile/${name} HTTP ${r.status}${/Application error/i.test(html) ? " + Application error in HTML" : ""}`);
    console.log("        NOTE: the known crash is client-side; this check cannot see it.");
    console.log("              Open the page in a browser and watch the console.");
  }
} catch (e) { bad(`profile check failed: ${e.message}`); }

console.log(`\n${"=".repeat(50)}\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
