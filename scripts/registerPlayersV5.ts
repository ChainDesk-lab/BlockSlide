// Backfill the V5 XP-leaderboard player registry with players who earned XP
// before the registry existed (pre-upgrade). Reads the known players from
// leaderboard-export.json and calls registerPlayers() — owner-only, idempotent,
// so it is safe to run more than once.
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
  const [deployer] = await viem.getWalletClients();

  console.log("\n🧩 Backfilling V5 XP player registry");
  console.log("   Operator:", deployer.account.address);

  // Collect the pre-V5 players to register (deduped, lowercased).
  const set = new Set<string>();

  // 1) Known on-chain players from the exported leaderboard.
  try {
    const exported = JSON.parse(
      readFileSync(join(__dirname, "../leaderboard-export.json"), "utf8"),
    ) as { leaderboard: Array<{ player: string }> };
    for (const e of exported.leaderboard) set.add(e.player.toLowerCase());
  } catch {
    console.log("   (no leaderboard-export.json — relying on EXTRA_PLAYERS)");
  }

  // 2) Any extra addresses passed via env.
  for (const a of (process.env.EXTRA_PLAYERS ?? "").split(",")) {
    const t = a.trim();
    if (t) set.add(t.toLowerCase());
  }

  const players = [...set] as `0x${string}`[];
  if (players.length === 0) {
    console.log(
      "\n   ⚠️  No players to register. Set EXTRA_PLAYERS or populate leaderboard-export.json.\n",
    );
    return;
  }

  const address = (process.env.GAME2048_ADDRESS ?? PROXY_ADDRESS) as `0x${string}`;
  const game = await viem.getContractAt("Game2048", address);

  console.log("   Contract:", address);
  console.log(
    "   Before — players registered:",
    (await game.read.getPlayerCount()).toString(),
  );
  console.log(`\n📋 Registering ${players.length} player(s):`);
  players.forEach((p, i) => console.log(`   ${i + 1}. ${p}`));

  const tx = await game.write.registerPlayers([players]);
  console.log(`\n🚀 registerPlayers tx: ${tx}`);
  const receipt = await viem.waitForTransactionReceipt({ hash: tx });
  console.log(`   ✓ Confirmed in block ${receipt.blockNumber}`);

  const [addrs, xps] = await game.read.getPlayersWithXp();
  console.log(`\n✅ Registry now has ${addrs.length} player(s):`);
  addrs.forEach((a, i) => console.log(`   ${a}  —  ${xps[i].toString()} XP`));
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
