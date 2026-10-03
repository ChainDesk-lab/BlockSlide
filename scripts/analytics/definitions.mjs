const URL = "https://api.goldsky.com/api/public/project_cmqr4hmlpe3gy01upecld9jhu/subgraphs/blockslide-leaderboard/2.0.0/gn";
async function gql(q){const r=await fetch(URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:q})});const j=await r.json();if(j.errors)throw new Error(JSON.stringify(j.errors));return j.data;}
let last="", all=[];
while(true){
  const d=await gql(`{ players(first:1000, orderBy:id, orderDirection:asc, where:{id_gt:"${last}"}) { id username xp gamesPlayed bestScore isVerified totalGEarned referralCount firstSeen } }`);
  if(!d.players.length) break;
  all.push(...d.players); last=d.players[d.players.length-1].id;
}
const n=(f)=>all.filter(f).length;
console.log(`Player entities (any indexed event)   : ${all.length}`);
console.log(`  with a username set                 : ${n(p=>p.username && p.username.length)}`);
console.log(`  username null/empty                 : ${n(p=>!p.username || !p.username.length)}`);
console.log(`  xp > 0                              : ${n(p=>Number(p.xp)>0)}`);
console.log(`  gamesPlayed > 0                     : ${n(p=>Number(p.gamesPlayed)>0)}`);
console.log(`  bestScore > 0                       : ${n(p=>Number(p.bestScore)>0)}`);
console.log(`  isVerified (GoodDollar)             : ${n(p=>p.isVerified)}`);
console.log(`  earned G$ > 0                       : ${n(p=>Number(p.totalGEarned)>0)}`);
console.log(`  referralCount > 0                   : ${n(p=>Number(p.referralCount)>0)}`);
const cutoff = Date.UTC(2026,8,3)/1000; // Sep 3
console.log(`  firstSeen before 2026-09-03         : ${n(p=>Number(p.firstSeen)<cutoff)}`);
const c2 = Date.UTC(2026,8,2)/1000;
console.log(`  firstSeen before 2026-09-02         : ${n(p=>Number(p.firstSeen)<c2)}`);
