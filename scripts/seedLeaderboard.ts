// Seed the leaderboard on a deployed Game2048 contract with exported data
// Reads from leaderboard-export.json and calls seedLeaderboard()
//
// Usage:
//   npx hardhat run scripts/seedLeaderboard.ts --network celoSepolia
//   npx hardhat run scripts/seedLeaderboard.ts --network celo (mainnet)

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ExportedLeaderboard {
  exportedAt: string;
  network: string;
  contractAddress: string;
  totalEntries: number;
  leaderboard: Array<{
    player: string;
    score: string;
    highestTile: number;
  }>;
}

async function main() {
  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const deployerAddr = deployer.account.address;

  console.log("\n🌱 Seeding leaderboard from exported data");
  console.log("   Operator:", deployerAddr);

  // Read exported leaderboard
  const exportPath = join(__dirname, "../leaderboard-export.json");
  let exported: ExportedLeaderboard;
  try {
    const raw = readFileSync(exportPath, "utf8");
    exported = JSON.parse(raw);
  } catch (e) {
    console.error(
      "\n❌ Could not read leaderboard-export.json. Make sure you ran Stage 1 (exportLeaderboard.ts) first.\n",
    );
    process.exit(1);
  }

  console.log(`   Exported: ${exported.exportedAt}`);
  console.log(`   Players: ${exported.totalEntries}`);

  if (exported.totalEntries === 0) {
    console.log("   ⚠️  No entries to seed.\n");
    return;
  }

  // Get game contract address from deployment info if available, or use an argument
  let gameAddress = process.env.GAME2048_ADDRESS;

  if (!gameAddress) {
    const deploymentPath = join(__dirname, "../deployment-dev-sepolia.json");
    try {
      const deploymentInfo = JSON.parse(readFileSync(deploymentPath, "utf8"));
      gameAddress = deploymentInfo.contracts.game2048Proxy;
    } catch {
      console.error(
        "\n❌ Could not find contract address. Set GAME2048_ADDRESS env var or ensure deployment-dev-sepolia.json exists.\n",
      );
      process.exit(1);
    }
  }

  console.log(`   Contract: ${gameAddress}`);

  // Connect to contract
  const game = await viem.getContractAt("Game2048", gameAddress as `0x${string}`);

  // Check if already seeded
  const alreadySeeded = await game.read.leaderboardSeeded();
  if (alreadySeeded) {
    console.error("\n❌ This contract has already been seeded. Cannot re-seed.\n");
    process.exit(1);
  }

  // Prepare data for seedLeaderboard()
  const players = exported.leaderboard.map((e) => e.player as `0x${string}`);
  const scores = exported.leaderboard.map((e) => BigInt(e.score));

  console.log(`\n📋 Seeding ${players.length} entries…`);
  exported.leaderboard.forEach((e, i) => {
    console.log(
      `   ${i + 1}. ${e.player.slice(0, 6)}…${e.player.slice(-4)} | Score: ${e.score}`,
    );
  });

  // Call seedLeaderboard()
  console.log("\n🚀 Calling seedLeaderboard()…");
  const tx = await game.write.seedLeaderboard([players, scores]);
  console.log(`   ✓ TX: ${tx}`);

  // Wait for confirmation and verify
  console.log("\n⏳ Waiting for confirmation…");
  const receipt = await viem.waitForTransactionReceipt({ hash: tx });
  console.log(`   ✓ Confirmed in block ${receipt.blockNumber}`);

  // Verify the seeded data
  console.log("\n✅ Verifying seeded data…");
  const leaderboard = await game.read.getLeaderboard();

  let matchCount = 0;
  for (let i = 0; i < Math.min(players.length, 10); i++) {
    const entry = leaderboard[i];
    if (entry.player.toLowerCase() === players[i].toLowerCase()) {
      if (entry.score === scores[i]) {
        console.log(
          `   ✓ Slot ${i}: ${entry.player.slice(0, 6)}…${entry.player.slice(-4)} | Score: ${entry.score}`,
        );
        matchCount++;
      } else {
        console.log(
          `   ❌ Slot ${i}: Score mismatch. Expected ${scores[i]}, got ${entry.score}`,
        );
      }
    } else {
      console.log(
        `   ❌ Slot ${i}: Address mismatch. Expected ${players[i]}, got ${entry.player}`,
      );
    }
  }

  if (matchCount === players.length) {
    console.log(`\n🎉 Success! All ${matchCount} entries match.\n`);
  } else {
    console.error(
      `\n❌ Verification failed. ${matchCount}/${players.length} entries matched.\n`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
