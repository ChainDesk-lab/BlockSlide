const URL = "https://api.goldsky.com/api/public/project_cmqr4hmlpe3gy01upecld9jhu/subgraphs/blockslide-leaderboard/2.0.0/gn";
async function gql(q){const r=await fetch(URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:q})});const j=await r.json();if(j.errors)throw new Error(JSON.stringify(j.errors));return j.data;}
let last="", all=[];
while(true){
  const d=await gql(`{ players(first:1000, orderBy:id, orderDirection:asc, where:{id_gt:"${last}"}) { id firstSeen xp } }`);
  if(!d.players.length) break;
  all.push(...d.players); last=d.players[d.players.length-1].id;
}
all.sort((a,b)=>Number(a.firstSeen)-Number(b.firstSeen));
console.log(`total players: ${all.length}`);
console.log(`first player : ${new Date(Number(all[0].firstSeen)*1000).toISOString()}`);
console.log(`newest player: ${new Date(Number(all[all.length-1].firstSeen)*1000).toISOString()}\n`);
// When did the cumulative count cross various milestones?
for (const target of [350, 380, 390, 395, 398, 400, 420, 450]) {
  if (all.length >= target) {
    const t = Number(all[target-1].firstSeen);
    console.log(`  count reached ${String(target).padStart(3)} on ${new Date(t*1000).toISOString().slice(0,10)}`);
  }
}
// Monthly cumulative
console.log("\ncumulative players by date:");
const byDay = new Map();
all.forEach((p,i)=>byDay.set(new Date(Number(p.firstSeen)*1000).toISOString().slice(0,10), i+1));
const days=[...byDay.entries()];
for (const [d,c] of days.filter((_,i)=>i%Math.ceil(days.length/14)===0 || i===days.length-1)) console.log(`  ${d}  ${c}`);
