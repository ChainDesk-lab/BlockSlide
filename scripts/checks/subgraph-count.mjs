const URL = "https://api.goldsky.com/api/public/project_cmqr4hmlpe3gy01upecld9jhu/subgraphs/blockslide-leaderboard/2.0.0/gn";
async function gql(query) {
  const r = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 400));
  return j.data;
}
const t = await gql(`{ __type(name: "Player") { fields { name type { name kind ofType { name } } } } }`);
console.log("Player fields:", t.__type.fields.map(f => f.name).join(", "));

const meta = await gql(`{ _meta { block { number } } }`);
console.log("indexed to block:", meta._meta.block.number);

// id-based cursor pagination (skip caps at 5000)
let last = "";
const all = [];
while (true) {
  const d = await gql(`{ players(first: 1000, orderBy: id, orderDirection: asc, where: { id_gt: "${last}" }) { id xp gamesPlayed } }`);
  const page = d.players;
  if (!page.length) break;
  all.push(...page);
  last = page[page.length - 1].id;
  process.stdout.write(`\r  fetched ${all.length}`);
}
console.log(`\n\nTOTAL Player entities: ${all.length}`);
const uniq = new Set(all.map(p => p.id.toLowerCase()));
console.log(`unique ids: ${uniq.size}`);
const withXp = all.filter(p => Number(p.xp) > 0).length;
const withGames = all.filter(p => Number(p.gamesPlayed ?? 0) > 0).length;
console.log(`players with xp > 0: ${withXp}`);
console.log(`players with gamesPlayed > 0: ${withGames}`);
const { writeFileSync, mkdirSync } = await import("node:fs");
mkdirSync("scripts/out", { recursive: true });
writeFileSync("scripts/out/subgraph-players.json", JSON.stringify({ indexedToBlock: meta._meta.block.number, total: all.length, ids: [...uniq] }, null, 2));
console.log("raw -> scripts/out/subgraph-players.json");
