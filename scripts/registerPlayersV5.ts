// Backfill the V5 XP-leaderboard player registry with players who earned XP
// before the registry existed (pre-upgrade). Reads the known players from
// leaderboard-export.json and calls registerPlayers() — owner-only, idempotent.
// Players already in the registry are skipped, so re-running costs no gas.
//
// Usage:
//   npx hardhat run scripts/registerPlayersV5.ts --network celo
//
// Optional env:
//   GAME2048_ADDRESS  override the proxy address
//   EXTRA_PLAYERS     comma-separated addresses to also register

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROXY_ADDRESS = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";

async function main() {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [deployer] = await viem.getWalletClients();

  console.log("\n🧩 Backfilling V5 XP player registry");
  console.log("   Operator:", deployer.account.address);

  // Desired players (deduped, lowercased).
  const want = new Set<string>();
  try {
    const exported = JSON.parse(
      readFileSync(join(__dirname, "../leaderboard-export.json"), "utf8"),
    ) as { leaderboard: Array<{ player: string }> };
    for (const e of exported.leaderboard) want.add(e.player.toLowerCase());
  } catch {
    console.log("   (no leaderboard-export.json — relying on EXTRA_PLAYERS)");
  }
  for (const a of (process.env.EXTRA_PLAYERS ?? "").split(",")) {
    const t = a.trim();
    if (t) want.add(t.toLowerCase());
  }

  if (want.size === 0) {
    console.log("\n   ⚠️  No players to register. Set EXTRA_PLAYERS.\n");
    return;
  }

  const address = (process.env.GAME2048_ADDRESS ?? PROXY_ADDRESS) as `0x${string}`;
  const game = await viem.getContractAt("Game2048", address);
  console.log("   Contract:", address);

  // Skip anyone already registered so re-runs are free.
  const [registered] = await game.read.getPlayersWithXp();
  const already = new Set(registered.map((a) => a.toLowerCase()));
  const toRegister = [...want].filter((p) => !already.has(p)) as `0x${string}`[];

  console.log("   Already registered:", already.size);

  if (toRegister.length === 0) {
    console.log("\n   ✓ All target players are already registered — nothing to do.");
  } else {
    console.log(`\n📋 Registering ${toRegister.length} new player(s):`);
    toRegister.forEach((p, i) => console.log(`   ${i + 1}. ${p}`));

    const tx = await game.write.registerPlayers([toRegister]);
    console.log(`\n🚀 registerPlayers tx: ${tx}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log(`   ✓ Confirmed in block ${receipt.blockNumber}`);
  }

  // Final registry state.
  const [addrs, xps] = await game.read.getPlayersWithXp();
  console.log(`\n✅ Registry now has ${addrs.length} player(s):`);
  addrs.forEach((a, i) => console.log(`   ${a}  —  ${xps[i].toString()} XP`));
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
