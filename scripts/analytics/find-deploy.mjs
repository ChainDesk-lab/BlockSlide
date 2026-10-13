import { createPublicClient, http, getAddress } from "viem";
import { celo } from "viem/chains";
const ADDR = getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");
const c = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
// Binary search the first block where the proxy has bytecode.
let lo = 0n, hi = await c.getBlockNumber();
const has = async (b) => { const x = await c.getBytecode({ address: ADDR, blockNumber: b }); return !!x && x !== "0x"; };
if (!(await has(hi))) { console.log("no code at head"); process.exit(1); }
while (lo < hi) {
  const mid = (lo + hi) / 2n;
  if (await has(mid)) hi = mid; else lo = mid + 1n;
}
console.log("deployment block:", lo);
const blk = await c.getBlock({ blockNumber: lo });
console.log("deployed at:", new Date(Number(blk.timestamp) * 1000).toISOString());
