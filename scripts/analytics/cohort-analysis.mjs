/**
 * Time-window stats from the demo-stats scan's per-address activity blocks.
 * Block boundaries for "7 days ago" / "14 days ago" are found by binary search
 * on block timestamps, so no timestamp interpolation is involved.
 */
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { readFileSync } from "node:fs";
const c=createPublicClient({chain:celo,transport:http("https://forno.celo.org",{timeout:30000}),batch:{multicall:false}});
const d=JSON.parse(readFileSync("scripts/out/demo-stats.json","utf8"));
const head=BigInt(d.toBlock);
const hb=await c.getBlock({blockNumber:head});
const now=Number(hb.timestamp);
async function blockAt(ts){
  let lo=BigInt(d.fromBlock),hi=head;
  while(lo<hi){const mid=(lo+hi)/2n;const b=await c.getBlock({blockNumber:mid});if(Number(b.timestamp)<ts)lo=mid+1n;else hi=mid;}
  return Number(lo);
}
const D=86400;
const b7=await blockAt(now-7*D), b14=await blockAt(now-14*D), b28=await blockAt(now-28*D);
console.log(`head block ${head} @ ${new Date(now*1000).toISOString()}`);
console.log(`  7d ago -> block ${b7}`);
console.log(` 14d ago -> block ${b14}`);
console.log(` 28d ago -> block ${b28}\n`);

const act=d.activity;
const addrs=Object.keys(act);
const first=a=>act[a][0], last=a=>act[a][act[a].length-1];
const inWin=(a,lo,hi)=>act[a].some(b=>b>=lo&&b<hi);

const totalNow=addrs.length;
const existed14=addrs.filter(a=>first(a)<b14).length;
const new14=addrs.filter(a=>first(a)>=b14).length;
const new7=addrs.filter(a=>first(a)>=b7).length;
console.log(`TOTAL users now            : ${totalNow}`);
console.log(`existed 14 days ago        : ${existed14}`);
console.log(`NEW in last 14 days        : ${new14}   (${(new14/totalNow*100).toFixed(1)}% of total)`);
console.log(`NEW in last 7 days         : ${new7}\n`);

const cur=addrs.filter(a=>inWin(a,b7,Number(head)+1));
const prev=addrs.filter(a=>inWin(a,b14,b7));
const both=cur.filter(a=>prev.includes(a));
console.log(`active last 7d             : ${cur.length}`);
console.log(`active prior 7d (14d-7d)   : ${prev.length}`);
console.log(`active in BOTH windows     : ${both.length}`);
console.log(`RETENTION (both/prior7d)   : ${prev.length?(both.length/prev.length*100).toFixed(1):"n/a"}%  <- % of prior-week actives who returned`);
const eligible=addrs.filter(a=>first(a)<b7);
const returning=eligible.filter(a=>inWin(a,b7,Number(head)+1));
console.log(`\nalt: users who existed before the 7d window: ${eligible.length}, of whom active in last 7d: ${returning.length} (${(returning.length/eligible.length*100).toFixed(1)}%)`);
const oneAndDone=addrs.filter(a=>act[a].length===1).length;
console.log(`\nsingle-event wallets (never returned): ${oneAndDone} (${(oneAndDone/totalNow*100).toFixed(1)}%)`);
