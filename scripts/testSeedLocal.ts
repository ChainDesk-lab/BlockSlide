// Test seedLeaderboard() on a local hardhat network
// Run: npx hardhat run scripts/testSeedLocal.ts
// This deploys a fresh contract locally and tests the seeding function

import { network } from "hardhat";
import { ethers } from "ethers";

async function main() {
  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const deployerAddr = deployer.account.address;

  console.log("\n🧪 Testing seedLeaderboard() on local network");
  console.log("   Deployer:", deployerAddr);

  // Deploy using viem
  console.log("\n📦 Deploying MockERC20…");
  const token = await viem.deployContract("MockERC20", []);
  console.log("   ✓ MockERC20:", token.address);

  console.log("\n📦 Deploying MockIdentity…");
  const identity = await viem.deployContract("MockIdentity", []);
  console.log("   ✓ MockIdentity:", identity.address);

  console.log("\n📦 Deploying Game2048 implementation…");
  const impl = await viem.deployContract("Game2048", []);
  console.log("   ✓ Game2048 impl:", impl.address);

  // Deploy ERC1967Proxy
  console.log("\n📦 Deploying ERC1967Proxy…");
  const initInterface = new ethers.Interface(["function initialize(address, address)"]);
  const initData = initInterface.encodeFunctionData("initialize", [
    token.address,
    identity.address,
  ]);

  const proxy = await viem.deployContract("ERC1967Proxy", [impl.address, initData]);
  console.log("   ✓ ERC1967Proxy:", proxy.address);

  // Connect to proxy through Game2048 ABI (using getContractAt returns a typed contract)
  const game = await viem.getContractAt("Game2048", proxy.address);

  // Check initialization
  const gDollarAddr = (await game.read.gDollar()) as string;
  const identityAddrRead = (await game.read.identity()) as string;
  console.log("\n✅ Initialization verified:");
  console.log("   G$ token:", gDollarAddr);
  console.log("   Identity:", identityAddrRead);

  // Test seedLeaderboard with sample data
  console.log("\n🌱 Testing seedLeaderboard()…");

  const samplePlayers = [
    "0xcb6f72152DB12546b21ef0dD5F614Ca532531838",
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
  ];

  const sampleScores = [5624n, 3000n, 2500n];

  console.log(`\n📋 Seeding ${samplePlayers.length} entries…`);
  samplePlayers.forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.slice(0, 6)}…${p.slice(-4)} | Score: ${sampleScores[i]}`);
  });

  // Call seedLeaderboard
  console.log("\n🚀 Calling seedLeaderboard()…");
  const tx = (await game.write.seedLeaderboard([
    samplePlayers as `0x${string}`[],
    sampleScores,
  ])) as string;
  console.log(`   ✓ TX: ${tx}`);

  // Verify seeded data
  console.log("\n✅ Verifying seeded data…");
  const leaderboard = (await game.read.getLeaderboard()) as Array<{
    player: string;
    score: bigint;
    highestTile: number;
  }>;

  let matchCount = 0;
  for (let i = 0; i < samplePlayers.length; i++) {
    const entry = leaderboard[i];
    const playerMatches = entry.player.toLowerCase() === samplePlayers[i].toLowerCase();
    const scoreMatches = entry.score === sampleScores[i];

    if (playerMatches && scoreMatches) {
      console.log(
        `   ✓ Slot ${i}: ${entry.player.slice(0, 6)}…${entry.player.slice(-4)} | Score: ${entry.score}`,
      );
      matchCount++;
    } else {
      console.log(`   ❌ Slot ${i}: Mismatch`);
      console.log(`      Expected: ${samplePlayers[i]} / ${sampleScores[i]}`);
      console.log(`      Got:      ${entry.player} / ${entry.score}`);
    }
  }

  // Try to seed again (should fail)
  console.log("\n🧪 Testing re-seeding protection…");
  try {
    await game.write.seedLeaderboard([
      [samplePlayers[0]] as `0x${string}`[],
      [1000n],
    ]);
    console.error("   ❌ Should have rejected second seedLeaderboard() call");
    process.exit(1);
  } catch (e: any) {
    if (e.message?.includes("LeaderboardAlreadySeeded")) {
      console.log("   ✓ Correctly rejected second seeding attempt");
    } else {
      console.log("   ✓ Rejected (error:", e.reason || e.message?.slice(0, 50), ")");
    }
  }

  if (matchCount === samplePlayers.length) {
    console.log(`\n🎉 All tests passed! ✅\n`);
  } else {
    console.error(`\n❌ Tests failed. ${matchCount}/${samplePlayers.length} matched.\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
