import { createPublicClient, http, getAddress } from "viem";
import { celo } from "viem/chains";
const ADDR = getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");
const c = createPublicClient({ chain: celo, transport: http("https://forno.celo.org", { timeout: 30000 }) });
// Find an OLD chunk that has logs.
let target = null;
for (let b = 71_000_000n; b < 71_600_000n && !target; b += 5000n) {
  try { const n = (await c.getLogs({ address: ADDR, fromBlock: b, toBlock: b + 4999n })).length; if (n > 0) target = [b, b + 4999n, n]; } catch {}
}
if (!target) { console.log("no old chunk with logs found in probe window"); process.exit(0); }
console.log(`old chunk ${target[0]}-${target[1]} first read: ${target[2]} logs`);
const counts = {};
for (let i = 0; i < 30; i++) {
  try { const n = (await c.getLogs({ address: ADDR, fromBlock: target[0], toBlock: target[1] })).length; counts[n] = (counts[n]||0)+1; }
  catch { counts["ERR"] = (counts["ERR"]||0)+1; }
}
console.log("30 repeats ->", JSON.stringify(counts));
console.log(Object.keys(counts).length === 1 ? "STABLE" : "*** VARIES: archive nodes disagree ***");
