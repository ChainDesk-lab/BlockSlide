import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const BLOCKSLIDE_ADDRESS = "0xd551317265b9c4d1d453d399d8b8fa0b98d8ceb6";
const CELO_RPC = "https://forno.celo.org";

const GAME2048_ABI = [
  "function owner() public view returns (address)",
  "function shieldPrice() public view returns (uint256)",
  "function boost2xPrice() public view returns (uint256)",
  "function boost5xPrice() public view returns (uint256)",
  "function undoPrice() public view returns (uint256)",
  "function cosmeticCatalog(uint256) public view returns (uint256 price, bool exists)",
  "function setShopPrices(uint256 _shieldPrice, uint256 _boost2xPrice, uint256 _boost5xPrice, uint256 _undoPrice) public",
  "function setCosmeticPrice(uint256 itemId, uint256 price) public",
];

const SHOP_PRICES = {
  shield: ethers.parseUnits("500", 18),     // 500 G$
  boost2x: ethers.parseUnits("1500", 18),   // 1500 G$
  boost5x: ethers.parseUnits("4000", 18),   // 4000 G$
  undo: ethers.parseUnits("100", 18),       // 100 G$
};

const COSMETIC_PRICES = {
  1: ethers.parseUnits("150", 18),  // Tile Skin - 150 G$
  2: ethers.parseUnits("125", 18),  // Fits - 125 G$
  3: ethers.parseUnits("100", 18),  // Leaderboard Flair - 100 G$
  4: ethers.parseUnits("75", 18),   // Goggles - 75 G$
  5: ethers.parseUnits("50", 18),   // Caps - 50 G$
};

const COSMETIC_NAMES = {
  1: "Tile Skin",
  2: "Fits",
  3: "Leaderboard Flair",
  4: "Goggles",
  5: "Caps",
};

async function readCurrentPrices() {
  const provider = new ethers.JsonRpcProvider(CELO_RPC);
  const contract = new ethers.Contract(BLOCKSLIDE_ADDRESS, GAME2048_ABI, provider);

  console.log("\n📍 Reading current shop prices from Celo mainnet...\n");

  console.log("═══════════════════════════════════════════════════════");
  console.log("  V5 SHOP PRICES (Power-Ups)");
  console.log("═══════════════════════════════════════════════════════");

  const v5Items = [
    { name: "Streak Shield", functionName: "shieldPrice" },
    { name: "Boost 2x", functionName: "boost2xPrice" },
    { name: "Boost 5x", functionName: "boost5xPrice" },
  ];

  for (const item of v5Items) {
    const priceRaw = await (contract as any)[item.functionName]();
    const priceFormatted = ethers.formatUnits(priceRaw, 18);
    console.log(`  ${item.name}: ${priceFormatted} G$ (${priceRaw.toString()})`);
  }

  // Read undo price
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  V6 PRICES (Undo & Cosmetics)");
  console.log("═══════════════════════════════════════════════════════");

  try {
    const undoPrice = await contract.undoPrice();
    const undoFormatted = ethers.formatUnits(undoPrice, 18);
    console.log(`  Undo Step: ${undoFormatted} G$ (${undoPrice.toString()})`);
  } catch (e) {
    console.log(`  Undo Step: ERROR - function may not exist`);
  }

  console.log("\n  Cosmetics:");
  for (const [itemId, expectedPrice] of Object.entries(COSMETIC_PRICES)) {
    try {
      const [price, exists] = await (contract as any).cosmeticCatalog(itemId);
      const priceFormatted = ethers.formatUnits(price, 18);
      const status = exists ? "✓" : "✗";
      console.log(`    ${itemId}. ${COSMETIC_NAMES[itemId as keyof typeof COSMETIC_NAMES]}: ${priceFormatted} G$ ${status}`);
    } catch (e) {
      console.log(`    ${itemId}. ${COSMETIC_NAMES[itemId as keyof typeof COSMETIC_NAMES]}: ERROR`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════\n");
}

async function simulateAndExecute() {
  const provider = new ethers.JsonRpcProvider(CELO_RPC);
  const contract = new ethers.Contract(BLOCKSLIDE_ADDRESS, GAME2048_ABI, provider);

  // Get private key
  const privateKey = process.env.OWNER_PRIVATE_KEY;
  if (!privateKey) {
    console.error("\n❌ ERROR: OWNER_PRIVATE_KEY not found in .env");
    console.error("   Please create .env file with: OWNER_PRIVATE_KEY=0x...");
    process.exit(1);
  }

  // Create signer
  const signer = new ethers.Wallet(privateKey, provider);
  const signerAddress = await signer.getAddress();
  const owner = await contract.owner();

  console.log("\n📋 Checking signer...");
  console.log(`Contract Owner:  ${owner}`);
  console.log(`Signer Address:  ${signerAddress}`);

  if (signerAddress.toLowerCase() !== owner.toLowerCase()) {
    console.error(`\n❌ ERROR: Signer is not the contract owner!`);
    process.exit(1);
  }

  console.log(`✅ Signer is owner\n`);

  const contractWithSigner = contract.connect(signer);

  // Set shop prices (V5 + V6)
  console.log("🚀 Setting V5+V6 shop prices...");
  console.log(`  Shield:      ${ethers.formatUnits(SHOP_PRICES.shield, 18)} G$`);
  console.log(`  Boost 2x:    ${ethers.formatUnits(SHOP_PRICES.boost2x, 18)} G$`);
  console.log(`  Boost 5x:    ${ethers.formatUnits(SHOP_PRICES.boost5x, 18)} G$`);
  console.log(`  Undo Step:   ${ethers.formatUnits(SHOP_PRICES.undo, 18)} G$`);

  const tx1 = await (contractWithSigner as any).setShopPrices(
    SHOP_PRICES.shield,
    SHOP_PRICES.boost2x,
    SHOP_PRICES.boost5x,
    SHOP_PRICES.undo
  );
  console.log(`📤 Tx: ${tx1.hash}`);
  await tx1.wait();
  console.log(`✅ Confirmed\n`);

  // Set cosmetic prices
  console.log("🚀 Setting cosmetic prices...");
  for (const [itemId, price] of Object.entries(COSMETIC_PRICES)) {
    console.log(`  ${itemId}. ${COSMETIC_NAMES[itemId as keyof typeof COSMETIC_NAMES]}: ${ethers.formatUnits(price, 18)} G$`);
    const tx = await (contractWithSigner as any).setCosmeticPrice(itemId, price);
    console.log(`     📤 Tx: ${tx.hash}`);
    await tx.wait();
    console.log(`     ✅`);
  }

  // Verify all prices
  console.log("\n✅ All transactions confirmed. Verifying prices...\n");

  console.log("═══════════════════════════════════════════════════════");
  console.log("  VERIFIED PRICES ON MAINNET");
  console.log("═══════════════════════════════════════════════════════");

  const shieldPrice = await contract.shieldPrice();
  const boost2xPrice = await contract.boost2xPrice();
  const boost5xPrice = await contract.boost5xPrice();
  const undoPrice = await contract.undoPrice();

  console.log("\nV5 Prices:");
  console.log(`  Shield:      ${ethers.formatUnits(shieldPrice, 18)} G$ ${shieldPrice === SHOP_PRICES.shield ? "✅" : "❌"}`);
  console.log(`  Boost 2x:    ${ethers.formatUnits(boost2xPrice, 18)} G$ ${boost2xPrice === SHOP_PRICES.boost2x ? "✅" : "❌"}`);
  console.log(`  Boost 5x:    ${ethers.formatUnits(boost5xPrice, 18)} G$ ${boost5xPrice === SHOP_PRICES.boost5x ? "✅" : "❌"}`);
  console.log(`  Undo Step:   ${ethers.formatUnits(undoPrice, 18)} G$ ${undoPrice === SHOP_PRICES.undo ? "✅" : "❌"}`);

  console.log("\nCosmetics:");
  for (const [itemId, expectedPrice] of Object.entries(COSMETIC_PRICES)) {
    const [price, exists] = await (contract as any).cosmeticCatalog(itemId);
    const match = price === expectedPrice && exists;
    console.log(`  ${itemId}. ${COSMETIC_NAMES[itemId as keyof typeof COSMETIC_NAMES]}: ${ethers.formatUnits(price, 18)} G$ ${match ? "✅" : "❌"}`);
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("\n✅ ALL PRICES SET SUCCESSFULLY!\n");
}

async function main() {
  const args = process.argv.slice(2);
  const shouldExecute = args.includes("--execute");

  if (!shouldExecute) {
    console.log("════════════════════════════════════════════════════════");
    console.log("  BlockSlide Shop Prices - V5 + V6");
    console.log("════════════════════════════════════════════════════════");
    await readCurrentPrices();

    console.log("🔍 READY TO SET PRICES\n");
    console.log("To proceed, run:\n");
    console.log("  npx ts-node scripts/set-shop-prices-v6.ts --execute\n");
    console.log("⚠️  Requires OWNER_PRIVATE_KEY in .env\n");
  } else {
    await simulateAndExecute();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
