import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY_ADDRESS = "0xd551317265b9c4d1d453d399d8b8fa0b98d8ceb6";
const CELO_RPC = "https://forno.celo.org";

// Proxy ABI for upgradeToAndCall
const PROXY_ABI = [
  "function owner() public view returns (address)",
  "function upgradeToAndCall(address newImplementation, bytes calldata data) public payable",
];

async function readBytecode(artifactName: string): Promise<string> {
  const artifactPath = path.join(__dirname, "..", "artifacts", `contracts/${artifactName}.sol`, `${artifactName}.json`);

  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}`);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
  return artifact.bytecode;
}

async function deployImplementation(signer: ethers.Wallet): Promise<string> {
  console.log("\n🔨 Deploying Game2048V6 implementation...\n");

  const bytecode = await readBytecode("Game2048V6");

  if (!bytecode || bytecode === "0x") {
    throw new Error("Invalid bytecode - contract may not be compiled");
  }

  console.log(`  Bytecode length: ${bytecode.length} bytes`);
  console.log(`  Deploying from: ${await signer.getAddress()}`);

  // Deploy the contract
  const factory = new ethers.ContractFactory(
    [
      "constructor()",
      "function owner() public view returns (address)",
    ],
    bytecode,
    signer
  );

  const deployTx = await factory.deploy();
  await deployTx.waitForDeployment();

  const implementationAddress = await deployTx.getAddress();
  console.log(`\n  ✅ Implementation deployed: ${implementationAddress}`);

  return implementationAddress;
}

async function upgradeProxy(signer: ethers.Wallet, newImplementation: string): Promise<void> {
  console.log("\n🚀 Upgrading proxy to V6...\n");

  const provider = new ethers.JsonRpcProvider(CELO_RPC);
  const proxy = new ethers.Contract(PROXY_ADDRESS, PROXY_ABI, signer);

  // Verify owner
  const owner = await proxy.owner();
  const signerAddr = await signer.getAddress();

  console.log(`  Proxy address:       ${PROXY_ADDRESS}`);
  console.log(`  Owner:               ${owner}`);
  console.log(`  Signer:              ${signerAddr}`);

  if (signerAddr.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`Signer is not the proxy owner!`);
  }

  console.log(`  ✅ Signer is owner\n`);

  // Upgrade
  console.log(`  New implementation:  ${newImplementation}`);
  console.log(`  Calling upgradeToAndCall()...\n`);

  // upgradeToAndCall(address, bytes) - we pass empty bytes since V6 doesn't need re-initialization
  const tx = await proxy.upgradeToAndCall(newImplementation, "0x");

  console.log(`  📤 Tx: ${tx.hash}`);
  console.log(`  ⏳ Waiting for confirmation...\n`);

  const receipt = await tx.wait();

  if (receipt?.status === 1) {
    console.log(`  ✅ Upgrade confirmed at block ${receipt.blockNumber}`);
  } else {
    throw new Error("Upgrade transaction failed");
  }
}

async function verifyUpgrade(): Promise<void> {
  console.log("\n✅ VERIFYING V6 UPGRADE\n");

  const provider = new ethers.JsonRpcProvider(CELO_RPC);
  const V6_ABI = [
    "function shieldPrice() public view returns (uint256)",
    "function boost2xPrice() public view returns (uint256)",
    "function boost5xPrice() public view returns (uint256)",
    "function undoPrice() public view returns (uint256)",
    "function cosmeticCatalog(uint256) public view returns (uint256 price, bool exists)",
    "function setCosmeticPrice(uint256, uint256) public",
  ];

  const proxy = new ethers.Contract(PROXY_ADDRESS, V6_ABI, provider);

  console.log("═══════════════════════════════════════════════════════");
  console.log("  TESTING V6 FUNCTIONS");
  console.log("═══════════════════════════════════════════════════════\n");

  try {
    const shieldPrice = await proxy.shieldPrice();
    console.log(`  ✅ shieldPrice(): ${ethers.formatUnits(shieldPrice, 18)} G$`);
  } catch (e) {
    console.log(`  ❌ shieldPrice(): ERROR`);
  }

  try {
    const undoPrice = await proxy.undoPrice();
    console.log(`  ✅ undoPrice(): ${ethers.formatUnits(undoPrice, 18)} G$`);
  } catch (e) {
    console.log(`  ❌ undoPrice(): ERROR`);
  }

  try {
    const [price, exists] = await proxy.cosmeticCatalog(1);
    console.log(`  ✅ cosmeticCatalog(1): exists=${exists}, price=${ethers.formatUnits(price, 18)} G$`);
  } catch (e) {
    console.log(`  ❌ cosmeticCatalog(1): ERROR`);
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("✅ V6 UPGRADE COMPLETE!\n");
  console.log("Next step: Set cosmetic and undo prices\n");
  console.log("  npx ts-node scripts/set-shop-prices-v6.ts --execute\n");
}

async function main() {
  const args = process.argv.slice(2);
  const shouldExecute = args.includes("--execute");

  console.log("\n════════════════════════════════════════════════════════");
  console.log("  BlockSlide V6 Upgrade");
  console.log("════════════════════════════════════════════════════════");

  const privateKey = process.env.OWNER_PRIVATE_KEY;
  if (!privateKey) {
    console.error("\n❌ ERROR: OWNER_PRIVATE_KEY not found in .env");
    console.error("   Please create .env file with: OWNER_PRIVATE_KEY=0x...");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(CELO_RPC);
  const signer = new ethers.Wallet(privateKey, provider);

  if (!shouldExecute) {
    console.log("\n📋 PRE-FLIGHT CHECKS\n");
    console.log("  Owner:              0xd551317265b9c4d1d453d399d8b8fa0b98d8ceb6");
    console.log(`  Signer:             ${await signer.getAddress()}`);
    console.log(`  Is owner?           ${(await signer.getAddress()).toLowerCase() === "0xd551317265b9c4d1d453d399d8b8fa0b98d8ceb6" ? "CHECKING..." : "CHECKING..."}`);

    console.log("\n🔍 TO PROCEED WITH UPGRADE, RUN:\n");
    console.log("  npx ts-node scripts/upgrade-to-v6.ts --execute\n");
    console.log("⚠️  This will:\n");
    console.log("  1. Deploy Game2048V6 implementation");
    console.log("  2. Call upgradeToAndCall() on the proxy");
    console.log("  3. Verify V6 functions work\n");
  } else {
    try {
      const implementation = await deployImplementation(signer);
      await upgradeProxy(signer, implementation);
      await verifyUpgrade();
    } catch (error) {
      console.error("\n❌ Upgrade failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
