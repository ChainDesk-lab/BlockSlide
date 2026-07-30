import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const BLOCKSLIDE_ADDRESS = "0xd551317265b9c4d1d453d399d8b8fa0b98d8ceb6";
const CELO_RPC = "https://forno.celo.org";

const GAME2048_ABI = [
  "function shieldPrice() public view returns (uint256)",
  "function boost2xPrice() public view returns (uint256)",
  "function boost5xPrice() public view returns (uint256)",
  "function owner() public view returns (address)",
  "function setShopPrices(uint256 _shieldPrice, uint256 _boost2xPrice, uint256 _boost5xPrice) public",
];

const PRICES = {
  shield: ethers.parseUnits("500", 18),    // 500 G$
  boost2x: ethers.parseUnits("1500", 18),  // 1500 G$
  boost5x: ethers.parseUnits("4000", 18),  // 4000 G$
};

async function readShopPrices() {
  const provider = new ethers.JsonRpcProvider(CELO_RPC);
  const contract = new ethers.Contract(BLOCKSLIDE_ADDRESS, GAME2048_ABI, provider);

  console.log("\n📍 Reading BlockSlide shop prices from Celo mainnet...\n");

  const shopItems = [
    { id: 1, name: "Streak Shield", functionName: "shieldPrice" },
    { id: 2, name: "Boost 2x", functionName: "boost2xPrice" },
    { id: 3, name: "Boost 5x", functionName: "boost5xPrice" },
  ];

  console.log("═══════════════════════════════════════════════════════");
  console.log("  CURRENT SHOP PRICES ON MAINNET");
  console.log("═══════════════════════════════════════════════════════");

  for (const item of shopItems) {
    const priceRaw = await (contract as any)[item.functionName]();
    const priceFormatted = ethers.formatUnits(priceRaw, 18);

    console.log(`\n  ID ${item.id}: ${item.name}`);
    console.log(`    Raw (wei):   ${priceRaw.toString()}`);
    console.log(`    Formatted:   ${priceFormatted} G$`);
  }

  console.log("\n═══════════════════════════════════════════════════════\n");
}

async function simulateSetShopPrices() {
  const provider = new ethers.JsonRpcProvider(CELO_RPC);
  const contract = new ethers.Contract(BLOCKSLIDE_ADDRESS, GAME2048_ABI, provider);

  console.log("🔍 Simulating setShopPrices transaction...\n");

  try {
    // Read owner to verify later
    const owner = await contract.owner();
    console.log(`Contract Owner: ${owner}`);

    // Get private key (never log it)
    const privateKey = process.env.OWNER_PRIVATE_KEY;
    if (!privateKey) {
      console.error("\n❌ ERROR: OWNER_PRIVATE_KEY not found in .env");
      console.error("   Please create .env file with: OWNER_PRIVATE_KEY=0x...");
      process.exit(1);
    }

    // Create signer from private key
    const signer = new ethers.Wallet(privateKey, provider);
    const signerAddress = await signer.getAddress();

    console.log(`Signer Address:  ${signerAddress}`);
    console.log(`Is Owner:        ${signerAddress.toLowerCase() === owner.toLowerCase() ? "✅ YES" : "❌ NO"}`);

    if (signerAddress.toLowerCase() !== owner.toLowerCase()) {
      console.error("\n❌ ERROR: Signer is not the contract owner!");
      console.error(`   Expected: ${owner}`);
      console.error(`   Got:      ${signerAddress}`);
      process.exit(1);
    }

    // Create contract instance with signer
    const contractWithSigner = contract.connect(signer);

    console.log("\n═══════════════════════════════════════════════════════");
    console.log("  PRICES TO BE SET");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`\n  Streak Shield:  ${ethers.formatUnits(PRICES.shield, 18)} G$`);
    console.log(`  Boost 2x:       ${ethers.formatUnits(PRICES.boost2x, 18)} G$`);
    console.log(`  Boost 5x:       ${ethers.formatUnits(PRICES.boost5x, 18)} G$`);

    // Simulate the transaction (eth_call via callStatic)
    console.log("\n📋 Simulating transaction (eth_call)...");
    await contractWithSigner.setShopPrices.staticCall(PRICES.shield, PRICES.boost2x, PRICES.boost5x);

    console.log("✅ Simulation successful - transaction will succeed\n");

    console.log("═══════════════════════════════════════════════════════");
    console.log("  ⏸️  AWAITING EXPLICIT CONFIRMATION");
    console.log("═══════════════════════════════════════════════════════");
    console.log("\nTo proceed with sending the transaction, run:");
    console.log('  npx ts-node scripts/shop-prices.ts --execute\n');

    return { signer, contractWithSigner, canExecute: true };
  } catch (error) {
    console.error("\n❌ Simulation failed:", error);
    process.exit(1);
  }
}

async function executeSetShopPrices(signer: ethers.Wallet, contract: ethers.Contract) {
  console.log("\n🚀 Executing setShopPrices transaction on mainnet...\n");

  try {
    const tx = await contract.setShopPrices(PRICES.shield, PRICES.boost2x, PRICES.boost5x);

    console.log(`📤 Transaction sent: ${tx.hash}`);
    console.log(`⏳ Waiting for confirmation...\n`);

    const receipt = await tx.wait();

    if (receipt?.status === 1) {
      console.log("═══════════════════════════════════════════════════════");
      console.log("  ✅ TRANSACTION CONFIRMED");
      console.log("═══════════════════════════════════════════════════════");
      console.log(`\nTx Hash:    ${tx.hash}`);
      console.log(`Block:      ${receipt?.blockNumber}`);
      console.log(`Gas Used:   ${receipt?.gasUsed?.toString()}`);
      console.log("\n✅ Shop prices successfully updated on mainnet!\n");
      return true;
    } else {
      console.error("\n❌ Transaction failed or reverted");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Transaction execution error:", error);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const shouldExecute = args.includes("--execute");

  if (!shouldExecute) {
    // Phase 1: Read current prices
    await readShopPrices();

    // Phase 2: Simulate
    await simulateSetShopPrices();
  } else {
    // Phase 2: Execute
    const provider = new ethers.JsonRpcProvider(CELO_RPC);
    const contract = new ethers.Contract(BLOCKSLIDE_ADDRESS, GAME2048_ABI, provider);

    const privateKey = process.env.OWNER_PRIVATE_KEY;
    if (!privateKey) {
      console.error("❌ OWNER_PRIVATE_KEY not found in .env");
      process.exit(1);
    }

    const signer = new ethers.Wallet(privateKey, provider);
    const contractWithSigner = contract.connect(signer);

    await executeSetShopPrices(signer, contractWithSigner);

    // Phase 3: Verify
    console.log("🔍 Verifying prices were set correctly...\n");
    const shopItems = [
      { id: 1, name: "Streak Shield", functionName: "shieldPrice", expected: PRICES.shield },
      { id: 2, name: "Boost 2x", functionName: "boost2xPrice", expected: PRICES.boost2x },
      { id: 3, name: "Boost 5x", functionName: "boost5xPrice", expected: PRICES.boost5x },
    ];

    console.log("═══════════════════════════════════════════════════════");
    console.log("  VERIFIED PRICES ON MAINNET");
    console.log("═══════════════════════════════════════════════════════");

    for (const item of shopItems) {
      const priceRaw = await (contract as any)[item.functionName]();
      const priceFormatted = ethers.formatUnits(priceRaw, 18);
      const matches = priceRaw === item.expected;

      console.log(`\n  ID ${item.id}: ${item.name}`);
      console.log(`    Set:      ${ethers.formatUnits(item.expected, 18)} G$`);
      console.log(`    Verified: ${priceFormatted} G$ ${matches ? "✅" : "❌"}`);
    }

    console.log("\n═══════════════════════════════════════════════════════\n");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
