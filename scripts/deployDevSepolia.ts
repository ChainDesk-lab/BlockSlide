// Deploy Game2048 with mocks to Celo Sepolia for testing
// Run: npx hardhat run scripts/deployDevSepolia.ts --network celoSepolia

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { network } from "hardhat";
import { ethers } from "ethers";

async function main() {
  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const deployerAddr = deployer.account.address;

  console.log("\n🚀 Deploying Game2048 + mocks to Celo Sepolia");
  console.log("   Deployer:", deployerAddr);

  // Deploy MockERC20
  console.log("\n📦 Deploying MockERC20…");
  const mockERC20 = await viem.deployContract("MockERC20", []);
  console.log("   ✓ MockERC20:", mockERC20.address);

  // Deploy MockIdentity
  console.log("\n📦 Deploying MockIdentity…");
  const mockIdentity = await viem.deployContract("MockIdentity", []);
  console.log("   ✓ MockIdentity:", mockIdentity.address);

  // Deploy Game2048 implementation
  console.log("\n📦 Deploying Game2048 implementation…");
  const impl = await viem.deployContract("Game2048", []);
  console.log("   ✓ Game2048 impl:", impl.address);

  // Encode initialization data using ethers
  const initInterface = new ethers.Interface([
    "function initialize(address _gDollar, address _identity)",
  ]);
  const initData = initInterface.encodeFunctionData("initialize", [
    mockERC20.address,
    mockIdentity.address,
  ]);

  // Deploy ERC1967Proxy
  console.log("\n📦 Deploying ERC1967Proxy…");
  const proxy = await viem.deployContract("ERC1967Proxy", [impl.address, initData]);
  console.log("   ✓ ERC1967Proxy (Game2048 proxy):", proxy.address);

  // Verify game contract is initialized
  const game = await viem.getContractAt("Game2048", proxy.address);
  const gdollarAddr = await game.read.gDollar();
  const identityAddr = await game.read.identity();
  console.log("\n✅ Initialization verified:");
  console.log("   G$ token:", gdollarAddr);
  console.log("   Identity:", identityAddr);

  // Whitelist deployer on MockIdentity so they can play
  console.log("\n⚙️  Whitelisting deployer on MockIdentity…");
  const identity = await viem.getContractAt("MockIdentity", mockIdentity.address);
  await identity.write.whitelist([deployerAddr]);
  console.log("   ✓ Whitelisted");

  // Fund treasury with mock G$
  console.log("\n💰 Funding treasury with 1000 mock G$…");
  const amount = 1000n * 10n ** 18n;
  const token = await viem.getContractAt("MockERC20", mockERC20.address);
  await token.write.mint([deployerAddr, amount]);
  await token.write.approve([proxy.address, amount]);
  await game.write.fundTreasury([amount]);
  console.log("   ✓ Treasury funded");

  // Save deployment addresses
  const deploymentInfo = {
    network: "celo-sepolia",
    timestamp: new Date().toISOString(),
    deployer: deployerAddr,
    contracts: {
      game2048Proxy: proxy.address,
      game2048Impl: impl.address,
      mockERC20: mockERC20.address,
      mockIdentity: mockIdentity.address,
    },
  };

  const outputPath = join(__dirname, "../deployment-dev-sepolia.json");
  writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));

  console.log("\n📄 Deployment info saved to:", outputPath);
  console.log("\n✨ Deployment complete!\n");
  console.log("   Game2048 Proxy:", proxy.address);
  console.log("   Use this in seedLeaderboard.ts\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
