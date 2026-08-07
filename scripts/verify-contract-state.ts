import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const BLOCKSLIDE_ADDRESS = "0xd551317265b9c4d1d453d399d8b8fa0b98d8ceb6";
const CELO_RPC = "https://forno.celo.org";

const CONTRACT_ABI = [
  "function owner() public view returns (address)",
  "function shieldPrice() public view returns (uint256)",
  "function boost2xPrice() public view returns (uint256)",
  "function boost5xPrice() public view returns (uint256)",
  "function undoPrice() public view returns (uint256)",
  "function cosmeticCatalog(uint256) public view returns (uint256 price, bool exists)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(CELO_RPC);
  const contract = new ethers.Contract(BLOCKSLIDE_ADDRESS, CONTRACT_ABI, provider);

  console.log("\n════════════════════════════════════════════════════════");
  console.log("  CONTRACT STATE VERIFICATION");
  console.log("════════════════════════════════════════════════════════\n");

  console.log(`📍 Contract Address: ${BLOCKSLIDE_ADDRESS}\n`);

  // Read owner
  console.log("📋 CONTRACT OWNER:");
  const owner = await contract.owner();
  console.log(`  Owner: ${owner}\n`);

  // Get signer
  const privateKey = process.env.OWNER_PRIVATE_KEY;
  if (!privateKey) {
    console.log("⚠️  OWNER_PRIVATE_KEY not in .env - cannot verify signer");
    console.log("   Skipping signer check\n");
  } else {
    const signer = new ethers.Wallet(privateKey, provider);
    const signerAddr = await signer.getAddress();
    console.log(`  Signer: ${signerAddr}`);
    const isOwner = owner.toLowerCase() === signerAddr.toLowerCase();
    console.log(`  Match:  ${isOwner ? "✅ YES" : "❌ NO"}\n`);
  }

  // Read V5 prices
  console.log("📊 V5 SHOP PRICES (Power-Ups):");
  try {
    const shield = await contract.shieldPrice();
    const boost2x = await contract.boost2xPrice();
    const boost5x = await contract.boost5xPrice();

    console.log(`  Shield:      ${shield.toString()} wei = ${ethers.formatUnits(shield, 18)} G$`);
    console.log(`  Boost 2x:    ${boost2x.toString()} wei = ${ethers.formatUnits(boost2x, 18)} G$`);
    console.log(`  Boost 5x:    ${boost5x.toString()} wei = ${ethers.formatUnits(boost5x, 18)} G$\n`);
  } catch (e) {
    console.log(`  ❌ Error reading V5 prices: ${(e as Error).message}\n`);
  }

  // Read V6 undo price
  console.log("📊 V6 UNDO PRICE:");
  try {
    const undo = await contract.undoPrice();
    console.log(`  Undo Step:   ${undo.toString()} wei = ${ethers.formatUnits(undo, 18)} G$\n`);
  } catch (e) {
    console.log(`  ❌ Error reading undoPrice: ${(e as Error).message}\n`);
  }

  // Read cosmetic prices
  console.log("📊 COSMETIC PRICES:");
  const cosmeticNames: Record<number, string> = {
    1: "Tile Skin",
    2: "Fits",
    3: "Leaderboard Flair",
    4: "Goggles",
    5: "Caps",
  };

  for (let id = 1; id <= 5; id++) {
    try {
      const [price, exists] = await (contract as any).cosmeticCatalog(id);
      const status = exists ? "✓ exists" : "✗ empty";
      console.log(
        `  ${id}. ${cosmeticNames[id].padEnd(20)} ${price.toString().padEnd(25)} wei = ${ethers.formatUnits(price, 18).padEnd(6)} G$ ${status}`
      );
    } catch (e) {
      console.log(`  ${id}. ${cosmeticNames[id].padEnd(20)} ❌ Error reading`);
    }
  }

  console.log("\n════════════════════════════════════════════════════════\n");

  // Check if previous tx was sent
  if (process.argv.includes("--check-tx")) {
    const txHash = process.argv[process.argv.indexOf("--check-tx") + 1];
    if (!txHash) {
      console.log("❌ No tx hash provided with --check-tx\n");
      return;
    }

    console.log(`📋 TRANSACTION STATUS:\n  Hash: ${txHash}\n`);

    try {
      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt) {
        console.log("  Status: ⏳ PENDING (not yet confirmed)\n");
      } else {
        const status = receipt.status === 1 ? "✅ SUCCESS" : "❌ REVERTED";
        console.log(`  Status: ${status}`);
        console.log(`  Block:  ${receipt.blockNumber}`);
        console.log(`  Gas:    ${receipt.gasUsed?.toString()} used\n`);
      }
    } catch (e) {
      console.log(`  ❌ Error checking tx: ${(e as Error).message}\n`);
    }
  } else {
    console.log("💡 To check a transaction status, run:");
    console.log("   npx ts-node scripts/verify-contract-state.ts --check-tx <txHash>\n");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
