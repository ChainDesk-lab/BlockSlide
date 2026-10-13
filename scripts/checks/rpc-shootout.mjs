import { createPublicClient, http, getAddress } from "viem";
import { celo } from "viem/chains";
const ADDR = getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");
const URLS = [
  "https://forno.celo.org",
  "https://celo.drpc.org",
  "https://celo-rpc.publicnode.com",
  "https://1rpc.io/celo",
  "https://rpc.ankr.com/celo",
];
// Old chunk that provably contains 1 log (seen 22/30 on forno).
const FROM = 71_030_000n, TO = 71_034_999n;
for (const url of URLS) {
  const c = createPublicClient({ chain: celo, transport: http(url, { timeout: 20000, retryCount: 0 }) });
  const counts = {};
  for (let i = 0; i < 20; i++) {
    try { const n = (await c.getLogs({ address: ADDR, fromBlock: FROM, toBlock: TO })).length; counts[n] = (counts[n]||0)+1; }
    catch (e) { const k = "ERR:" + String(e.shortMessage||e.message).slice(0,30); counts[k] = (counts[k]||0)+1; }
  }
  const keys = Object.keys(counts);
  const verdict = keys.length === 1 && keys[0] === "1" ? "  <== COMPLETE & STABLE" : "";
  console.log(`${url.padEnd(34)} ${JSON.stringify(counts)}${verdict}`);
}
