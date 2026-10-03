/**
 * Set shop item prices on-chain (Celo mainnet)
 *
 * Prices (in wei/wad, multiply by 1e18 for raw values):
 * - Streak Shield:  2,150 G$ (~$0.25)
 * - 2x XP Boost:    3,870 G$ (~$0.45)
 * - 5x XP Boost:    6,880 G$ (~$0.80)
 *
 * Call from: Owner wallet (has onlyOwner modifier)
 * Network: Celo mainnet
 */

import { parseEther } from "viem";
import { network } from "hardhat";

async function main() {
  const { viem } = await network.create();
  const [owner] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  // Game2048 contract address on Celo mainnet
  const GAME2048_ADDRESS = "0xdee5ecac921b7c8ed4e6e3c22098e0b6d1707bf0";

  // New prices (in G$, will be multiplied by 1e18 for wei)
  const SHIELD_PRICE = parseEther("2150");    // 2,150 G$
  const BOOST_2X_PRICE = parseEther("3870");  // 3,870 G$
  const BOOST_5X_PRICE = parseEther("6880");  // 6,880 G$

  console.log("📋 Transaction Details:");
  console.log("========================");
  console.log(`Contract: ${GAME2048_ADDRESS}`);
  console.log(`Function: setShopPrices()`);
  console.log(`Caller: ${owner.account.address}`);
  console.log("");
  console.log("🔧 New Prices:");
  console.log(`  Streak Shield:  ${SHIELD_PRICE.toString()} wei = 2,150 G$ (~$0.25)`);
  console.log(`  2x XP Boost:    ${BOOST_2X_PRICE.toString()} wei = 3,870 G$ (~$0.45)`);
  console.log(`  5x XP Boost:    ${BOOST_5X_PRICE.toString()} wei = 6,880 G$ (~$0.80)`);
  console.log("");

  // Prepare and send transaction
  console.log("⏳ Sending transaction...");
  const hash = await owner.writeContract({
    account: owner.account,
    address: GAME2048_ADDRESS as `0x${string}`,
    abi: [
      {
        name: "setShopPrices",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "_shieldPrice", type: "uint256" },
          { name: "_boost2xPrice", type: "uint256" },
          { name: "_boost5xPrice", type: "uint256" },
        ],
        outputs: [],
      },
    ],
    functionName: "setShopPrices",
    args: [SHIELD_PRICE, BOOST_2X_PRICE, BOOST_5X_PRICE],
  });

  console.log(`✅ Transaction sent!`);
  console.log(`📍 Hash: ${hash}`);
  console.log(`🔗 View: https://celoscan.io/tx/${hash}`);
  console.log("");
  console.log("⏱️  Waiting for confirmation...");

  // Wait for receipt
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "success") {
    console.log("✅ Transaction confirmed!");
    console.log("");
    console.log("✨ Shop Prices Updated:");
    console.log(`  • Streak Shield:  2,150 G$ (~$0.25)`);
    console.log(`  • 2x XP Boost:    3,870 G$ (~$0.45)`);
    console.log(`  • 5x XP Boost:    6,880 G$ (~$0.80)`);
    console.log("");
    console.log("📝 Frontend defaults already updated");
    console.log("🎮 Players will see new prices after refresh");
  } else {
    console.error("❌ Transaction failed!");
    console.error(`Status: ${receipt.status}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
