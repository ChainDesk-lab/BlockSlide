/**
 * Ground-truth G$ economics for BlockSlide, read from Celo mainnet.
 *
 * Measures actual ERC-20 Transfer amounts on the G$ token where the Game2048
 * proxy is the counterparty — NOT purchase-count x hardcoded price, which is
 * what get-shop-revenue-and-ubi.mjs does. Shop prices have been changed on
 * chain (ShopPricesUpdated fired), so the hardcoded-price estimate is wrong.
 *
 * Transfers come from Blockscout rather than eth_getLogs. Public Celo RPCs
 * return false-empty getLogs results on historical ranges (see
 * celo-rpc-archive-unreliable), so a log sweep needs ~8 repeated reads over
 * 1781 chunks per direction to converge — hours. Blockscout serves the same
 * ledger from its own index in a few paginated calls, and needs no API key
 * (Celoscan and Etherscan V2 both reject keyless requests).
 *
 * Blockscout's index is not complete either — it was caught missing two real
 * inbound transfers. So the ledger is reconciled against balanceOf, which is a
 * direct state read and cannot be wrong, and any shortfall is hunted down by
 * binary search + a high-repeat RPC read of the offending window.
 *
 * Contract money paths (contracts/Game2048.sol):
 *   in  <- transferFrom(player, this, price)   buyStreakShield / buyXpBoost  = revenue
 *   in  <- transferFrom(owner,  this, amount)  fundTreasury                  = float, not revenue
 *   out -> transfer(player, amount)            _payReward                    = payouts
 *   out -> transfer(owner(), amount)           withdraw                      = extraction
 *
 * Counterparty separates revenue from treasury float, except that the owner
 * wallet is ALSO the top-scoring player — so owner-side transfers are
 * disambiguated by pulling their receipts and looking for a RewardPaid or a
 * shop event in the same tx.
 *
 * Usage: node scripts/gdollar-flows.mjs
 * Out:   scripts/out/gdollar-flows.json
 */
import { createPublicClient, http, getAddress, parseAbi, toEventSelector } from "viem";
import { celo } from "viem/chains";
import { writeFileSync, mkdirSync } from "node:fs";

const GAME = getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");
const GDOLLAR = getAddress("0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A");
const IDENTITY = getAddress("0xC361A6E67822a0EDc17d899227dd9FC50BD62F42");
const BLOCKSCOUT = process.env.BLOCKSCOUT ?? "https://celo.blockscout.com";

const rpc = createPublicClient({
  chain: celo,
  transport: http(process.env.RPC ?? "https://forno.celo.org", { timeout: 30_000 }),
});

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);
const GAME_ABI = parseAbi(["function owner() view returns (address)"]);
const IDENTITY_ABI = parseAbi(["function isWhitelisted(address) view returns (bool)"]);

const head = await rpc.getBlockNumber();
const owner = await rpc.readContract({ address: GAME, abi: GAME_ABI, functionName: "owner" });
const fmtG = (wei) => `${(Number(wei) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 })} G$`;

console.log(`game      : ${GAME}`);
console.log(`G$ token  : ${GDOLLAR}`);
console.log(`owner     : ${owner}`);
console.log(`head      : ${head}`);
console.log(`source    : ${BLOCKSCOUT} (reconciled against balanceOf)\n`);

/** Page through every G$ transfer where the game contract is a counterparty. */
async function fetchTransfers() {
  const out = [];
  let params = null;
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({ type: "ERC-20", token: GDOLLAR });
    for (const [k, v] of Object.entries(params ?? {})) qs.set(k, String(v));
    const url = `${BLOCKSCOUT}/api/v2/addresses/${GAME}/token-transfers?${qs}`;
    let json = null;
    for (let attempt = 0; attempt < 5 && json === null; attempt++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        json = await r.json();
      } catch (e) {
        if (attempt === 4) throw new Error(`blockscout page ${page}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    out.push(...(json.items ?? []));
    process.stdout.write(`\r  fetched ${out.length} transfers (page ${page})   `);
    if (!json.next_page_params) break;
    params = json.next_page_params;
  }
  console.log();
  return out;
}

const raw = await fetchTransfers();

// Normalise. Blockscout nests addresses and puts the amount in total.value.
// Dedupe on (tx, log_index) — the true identity of a transfer. Keying on
// from/to/value instead would silently collapse the many distinct 0 G$
// purchases into one.
const seen = new Map();
for (const t of raw) {
  seen.set(`${t.transaction_hash}:${t.log_index}`, {
    hash: t.transaction_hash,
    block: Number(t.block_number),
    from: getAddress(t.from.hash),
    to: getAddress(t.to.hash),
    value: BigInt(t.total.value),
  });
}
const all = [...seen.values()];

// Blockscout's per-address index is NOT complete — it was observed missing two
// real inbound transfers. balanceOf is a direct state read and cannot lie, so
// use it as the oracle: if the ledger does not reproduce the on-chain balance,
// binary-search the divergence and recover the missing transfers over RPC.
// Reporting an unreconciled ledger would understate the numbers silently.
const balanceAt = async (b) => rpc.readContract({
  address: GDOLLAR, abi: ERC20, functionName: "balanceOf", args: [GAME],
  ...(b === undefined ? {} : { blockNumber: BigInt(b) }),
});
const ledgerAt = (b) => all
  .filter((t) => t.block <= b)
  .reduce((a, t) => a + (t.to === GAME ? t.value : -t.value), 0n);

const TRANSFER_EV = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
])[0];

/** High-repeat windowed read; public Celo RPCs return false-empty getLogs. */
async function recoverWindow(from, to) {
  const found = new Map();
  for (let rep = 0; rep < 30; rep++) {
    for (const args of [{ to: GAME }, { from: GAME }]) {
      try {
        const logs = await rpc.getLogs({
          address: GDOLLAR, event: TRANSFER_EV, args,
          fromBlock: BigInt(from), toBlock: BigInt(to),
        });
        for (const l of logs) {
          found.set(`${l.transactionHash}:${l.logIndex}`, {
            hash: l.transactionHash, block: Number(l.blockNumber),
            from: getAddress(l.args.from), to: getAddress(l.args.to), value: l.args.value,
          });
        }
      } catch { /* retry on next rep */ }
    }
  }
  return [...found.values()];
}

let recovered = [];
for (let pass = 0; pass < 6; pass++) {
  const gap = (await balanceAt()) - ledgerAt(Number(head));
  if (gap === 0n) break;
  console.log(`\n  ledger is short by ${fmtG(gap)} — locating missing transfers`);
  // Binary-search the earliest block where ledger and chain disagree.
  let lo = 69_294_066, hi = Number(head);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    let chain = null;
    for (let i = 0; i < 6 && chain === null; i++) {
      try { chain = await balanceAt(mid); } catch { await new Promise((r) => setTimeout(r, 600 * (i + 1))); }
    }
    if (chain === null) { lo = mid; continue; }
    if (chain - ledgerAt(mid) === 0n) lo = mid; else hi = mid;
  }
  const found = await recoverWindow(Math.max(lo - 40, 69_294_066), hi + 40);
  const added = found.filter((f) => !seen.has(`${f.hash}:${f.block}`) &&
    !all.some((t) => t.hash === f.hash && t.value === f.value && t.from === f.from && t.to === f.to));
  if (!added.length) { console.log(`  could not recover around block ${hi} — numbers below are a LOWER BOUND`); break; }
  for (const f of added) {
    all.push(f);
    recovered.push(f);
    console.log(`  recovered blk${f.block} ${fmtG(f.value)} ${f.from.slice(0, 10)} -> ${f.to.slice(0, 10)}`);
  }
}
const finalGap = (await balanceAt()) - ledgerAt(Number(head));
console.log(finalGap === 0n
  ? `\n  ledger reconciles exactly against balanceOf ✓`
  : `\n  !! ledger still ${fmtG(finalGap)} short of balanceOf — treat totals as a LOWER BOUND`);

const isOwner = (a) => a.toLowerCase() === owner.toLowerCase();
const inflow = all.filter((t) => t.to.toLowerCase() === GAME.toLowerCase());
const outflow = all.filter((t) => t.from.toLowerCase() === GAME.toLowerCase());

// Classify every inbound transfer by pulling its receipt. There are only a few
// dozen, and the headline numbers must not depend on a flaky lookup: sender
// identity is deterministic, and the shop-event check is a hard confirmation
// rather than a guess. A purchase tx carries a *Purchased event from the game;
// a bare treasury top-up carries no game event at all.
const sel = (sig) => toEventSelector(`event ${sig}`);
const REWARD_T0 = sel("RewardPaid(address,uint32,uint256)");
// The proxy has been upgraded ~11 times; both old and new shop event shapes
// appear on chain, so every variant must be recognised.
const SHOP_T0 = new Set([
  sel("ShieldPurchased(address,uint256)"),
  sel("ShieldPurchased(address,uint256,uint256)"),
  sel("XpBoostPurchased(address,uint8,uint64)"),
  sel("XpBoostPurchased(address,uint8,uint64,uint256)"),
  sel("UndoPurchased(address,uint256,uint256)"),
  sel("CosmeticPurchased(address,uint256,uint256)"),
]);

const txKind = new Map(); // tx hash -> {shop, reward}
const needed = [...new Set([...inflow, ...outflow].map((t) => t.hash))];
process.stdout.write(`  classifying ${needed.length} transactions by receipt... `);
let unresolved = 0;
for (const hash of needed) {
  let got = false;
  for (let i = 0; i < 8 && !got; i++) {
    try {
      const r = await rpc.getTransactionReceipt({ hash });
      const mine = r.logs.filter((l) => l.address.toLowerCase() === GAME.toLowerCase());
      txKind.set(hash, {
        shop: mine.some((l) => SHOP_T0.has(l.topics[0])),
        reward: mine.some((l) => l.topics[0] === REWARD_T0),
      });
      got = true;
    } catch { await new Promise((r) => setTimeout(r, 500 * (i + 1))); }
  }
  if (!got) { unresolved++; txKind.set(hash, null); }
}
console.log(unresolved ? `${unresolved} unresolved` : "all resolved");

const kindOf = (t) => txKind.get(t.hash);
// A payout is a transfer out sharing its tx with RewardPaid. Falls back to
// "any non-owner recipient" only when the receipt could not be read.
const isPayout = (t) => { const k = kindOf(t); return k ? k.reward : !isOwner(t.to); };
const isShopBuy = (t) => { const k = kindOf(t); return k ? k.shop : !isOwner(t.from); };

// Revenue means G$ that an external player actually spent. The owner wallet is
// also the top-scoring player and made most of the paid purchases itself; that
// is self-dealing, not revenue, so it is reported separately.
const isRevenue = (t) => isShopBuy(t) && !isOwner(t.from);

const revenueIn = inflow.filter(isRevenue);
const fundingIn = inflow.filter((t) => !isRevenue(t));
const ownerShopIn = inflow.filter((t) => isShopBuy(t) && isOwner(t.from));
const externalTopUpIn = inflow.filter((t) => !isShopBuy(t) && !isOwner(t.from));
const payoutOut = outflow.filter(isPayout);
const withdrawOut = outflow.filter((t) => !isPayout(t));

const sum = (xs) => xs.reduce((a, b) => a + b, 0n);
const fmt = (wei) => Number(wei) / 1e18;
const g = fmtG;

const totalIn = sum(inflow.map((t) => t.value));
const totalOut = sum(outflow.map((t) => t.value));
const revenueWei = sum(revenueIn.map((t) => t.value));
const fundingWei = sum(fundingIn.map((t) => t.value));
const payoutWei = sum(payoutOut.map((t) => t.value));
const withdrawWei = sum(withdrawOut.map((t) => t.value));

const balance = await rpc.readContract({
  address: GDOLLAR, abi: ERC20, functionName: "balanceOf", args: [GAME],
});

// Net distributed to GoodDollar-verified humans. isWhitelisted has no events,
// so this reads verification status NOW, not as it was at payout time.
const payees = [...new Set(payoutOut.map((t) => t.to))];
const spenders = [...new Set(revenueIn.map((t) => t.from))];
const toCheck = [...new Set([...payees, ...spenders])];
process.stdout.write(`  checking isWhitelisted for ${toCheck.length} addresses... `);
const verified = new Set();
for (let i = 0; i < toCheck.length; i += 50) {
  const batch = toCheck.slice(i, i + 50);
  const res = await rpc.multicall({
    contracts: batch.map((a) => ({
      address: IDENTITY, abi: IDENTITY_ABI, functionName: "isWhitelisted", args: [a],
    })),
    allowFailure: true,
  });
  res.forEach((r, j) => { if (r.status === "success" && r.result) verified.add(batch[j]); });
}
console.log(`${verified.size} verified`);

const verifiedPayoutWei = sum(payoutOut.filter((t) => verified.has(t.to)).map((t) => t.value));
const verifiedPayees = payees.filter((a) => verified.has(a));

const line = (k, v) => console.log(`  ${k.padEnd(38)} ${v}`);
console.log(`\n${"=".repeat(64)}\nG$ ECONOMICS  (block ${head})\n${"=".repeat(64)}`);

console.log("\n-- 1. TOTAL G$ VOLUME THROUGH THE GAME --");
line("gross volume (in + out)", g(totalIn + totalOut));
line("  total inflow", `${g(totalIn)}  (${inflow.length} transfers)`);
line("  total outflow", `${g(totalOut)}  (${outflow.length} transfers)`);

console.log("\n-- 2. G$ PAID OUT TO PLAYERS --");
line("rewards to players", `${g(payoutWei)}  (${payoutOut.length} transfers)`);
line("unique players paid", payees.length);

console.log("\n-- 3. TREASURY --");
line("current contract balance", g(balance));
line("owner wallet inflow (see §5)", `${g(fundingWei)}  (${fundingIn.length} transfers)`);
line("owner withdrawals out", `${g(withdrawWei)}  (${withdrawOut.length} transfers)`);

console.log("\n-- 4. TO GOODDOLLAR-VERIFIED WALLETS --");
line("paid to verified wallets", g(verifiedPayoutWei));
line("verified payees", `${verifiedPayees.length} of ${payees.length}`);
line("share of payouts", payoutWei > 0n ? `${(fmt(verifiedPayoutWei) / fmt(payoutWei) * 100).toFixed(1)}%` : "n/a");

console.log("\n-- 5. SHOP REVENUE (measured, not price-estimated) --");
line("external players' spend  [REVENUE]", `${g(revenueWei)}  (${revenueIn.length} purchases)`);
line("  unique external buyers", spenders.length);
line("owner's own purchases  [self-dealing]", `${g(sum(ownerShopIn.map((t) => t.value)))}  (${ownerShopIn.length} purchases)`);
line("external top-ups (no purchase event)", `${g(sum(externalTopUpIn.map((t) => t.value)))}  (${externalTopUpIn.length} transfers)`);
console.log("\n  The owner wallet is also the top-scoring player. Its purchases are");
console.log("  the project paying itself and are NOT third-party revenue.");
console.log(`\n${"=".repeat(64)}`);

mkdirSync("scripts/out", { recursive: true });
writeFileSync("scripts/out/gdollar-flows.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: BLOCKSCOUT,
  game: GAME, gdollar: GDOLLAR, owner, toBlock: head.toString(),
  transferCount: all.length,
  grossVolumeG: fmt(totalIn + totalOut),
  inflowG: fmt(totalIn), outflowG: fmt(totalOut),
  paidToPlayersG: fmt(payoutWei), uniquePayees: payees.length,
  treasuryBalanceG: fmt(balance),
  ownerFundingG: fmt(fundingWei), ownerWithdrawalsG: fmt(withdrawWei),
  verifiedPayoutG: fmt(verifiedPayoutWei), verifiedPayees: verifiedPayees.length,
  externalShopRevenueG: fmt(revenueWei), uniqueExternalBuyers: spenders.length,
  ownerSelfPurchaseG: fmt(sum(ownerShopIn.map((t) => t.value))),
  externalTopUpG: fmt(sum(externalTopUpIn.map((t) => t.value))),
  recoveredTransfers: recovered.map((r) => ({ block: r.block, hash: r.hash, value: r.value.toString() })),
  ledgerReconciles: finalGap === 0n,
  payees, verifiedPayeeAddresses: verifiedPayees, spenders,
}, null, 2));
console.log("raw -> scripts/out/gdollar-flows.json");
