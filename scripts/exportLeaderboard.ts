// Export the current leaderboard from the deployed Game2048 contract.
// Deduplicates by address (keeping highest score per player) and saves to JSON.
//
// Usage:
//   npx hardhat run scripts/exportLeaderboard.ts --network celo

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { GAME2048_ABI } from "../frontend/src/lib/abi";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Celo mainnet
const GAME2048_ADDRESS = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6" as `0x${string}`;

interface LeaderboardEntry {
  player: string;
  score: bigint;
  highestTile: number;
}

interface DedupEntry {
  player: string;
  score: string;
  highestTile: number;
}

async function main() {
  const { viem } = await network.create();

  console.log("\n📊 Exporting leaderboard from", GAME2048_ADDRESS);

  const game = await viem.getContractAt("Game2048", GAME2048_ADDRESS, {
    abi: GAME2048_ABI,
  });

  // Read the raw leaderboard (10 slots)
  const rawLeaderboard = (await game.read.getLeaderboard()) as LeaderboardEntry[];
  console.log(`  Raw leaderboard entries: ${rawLeaderboard.length}`);

  // Filter out empty slots and deduplicate by address (keep highest score)
  const dedup = new Map<string, LeaderboardEntry>();

  for (const entry of rawLeaderboard) {
    const zeroAddr = "0x0000000000000000000000000000000000000000";
    if (entry.player.toLowerCase() === zeroAddr) continue; // Skip empty slots

    const addrKey = entry.player.toLowerCase();
    const existing = dedup.get(addrKey);

    // Keep the entry with the higher score
    if (!existing || entry.score > existing.score) {
      dedup.set(addrKey, entry);
    }
  }

  // Convert to output format
  const deduped: DedupEntry[] = Array.from(dedup.values())
    .sort((a, b) => (a.score > b.score ? -1 : a.score < b.score ? 1 : 0))
    .map((e) => ({
      player: e.player,
      score: e.score.toString(),
      highestTile: e.highestTile,
    }));

  console.log(`  After dedup: ${deduped.length} unique players\n`);

  // Display preview
  if (deduped.length > 0) {
    console.log("  Top 10:");
    deduped.slice(0, 10).forEach((e, i) => {
      console.log(
        `    ${i + 1}. ${e.player.slice(0, 6)}…${e.player.slice(-4)} | Score: ${e.score} | Tile: ${e.highestTile}`,
      );
    });
    if (deduped.length > 10) {
      console.log(`    … and ${deduped.length - 10} more\n`);
    }
  }

  // Save to file
  const outputPath = join(__dirname, "../leaderboard-export.json");
  const output = {
    exportedAt: new Date().toISOString(),
    network: "celo-mainnet",
    contractAddress: GAME2048_ADDRESS,
    totalEntries: deduped.length,
    leaderboard: deduped,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`✅ Exported to ${outputPath}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
