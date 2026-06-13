// Run after deploying Game2048DevModule on Alfajores:
//   npx hardhat run scripts/setup-dev.ts --network alfajores
//
// What this does:
//   1. Reads the deployed addresses from Ignition artifacts automatically
//   2. Whitelists your wallet on MockIdentity so startSession() succeeds
//   3. Mints 1 000 mock G$ and deposits it into the Game2048 treasury
//   4. Prints the Game2048 address for you to paste into constants.ts

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CHAIN_ID = 11142220; // Celo Sepolia (replaces Alfajores)

async function main() {
  // ── Read Ignition deployment artifacts ────────────────────────────────────
  const artifactPath = join(
    __dirname,
    `../ignition/deployments/chain-${CHAIN_ID}/deployed_addresses.json`,
  );

  let deployed: Record<string, string>;
  try {
    deployed = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch {
    console.error(`\nNo deployment found at:\n  ${artifactPath}`);
    console.error("\nRun this first:\n  npx hardhat ignition deploy ignition/modules/Game2048Dev.ts --network alfajores\n");
    process.exit(1);
  }

  const GAME_ADDRESS     = deployed["Game2048DevModule#Game2048"]     as `0x${string}`;
  const MOCK_TOKEN       = deployed["Game2048DevModule#MockERC20"]    as `0x${string}`;
  const MOCK_IDENTITY    = deployed["Game2048DevModule#MockIdentity"] as `0x${string}`;

  if (!GAME_ADDRESS || !MOCK_TOKEN || !MOCK_IDENTITY) {
    console.error("Could not find all three contracts in the deployment artifact.");
    console.error("Artifact contents:", deployed);
    process.exit(1);
  }

  console.log("\nDeployed contracts:");
  console.log("  Game2048:     ", GAME_ADDRESS);
  console.log("  MockERC20:    ", MOCK_TOKEN);
  console.log("  MockIdentity: ", MOCK_IDENTITY);

  // ── Connect to Alfajores ──────────────────────────────────────────────────
  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const deployerAddr = deployer.account.address;
  console.log("\nDeployer:", deployerAddr);

  const identity = await viem.getContractAt("MockIdentity", MOCK_IDENTITY);
  const token    = await viem.getContractAt("MockERC20",    MOCK_TOKEN);
  const game     = await viem.getContractAt("Game2048",     GAME_ADDRESS);

  // ── 1. Whitelist the deployer ─────────────────────────────────────────────
  console.log("\nWhitelisting deployer on MockIdentity…");
  await identity.write.whitelist([deployerAddr]);
  console.log("  ✓ Whitelisted");

  // ── 2. Mint 1 000 mock G$ and fund the treasury ───────────────────────────
  console.log("\nFunding treasury with 1 000 mock G$…");
  const amount = 1_000n * 10n ** 18n;
  await token.write.mint([deployerAddr, amount]);
  await token.write.approve([GAME_ADDRESS, amount]);
  await game.write.fundTreasury([amount]);
  console.log("  ✓ Treasury funded");

  // ── 3. Auto-patch frontend/src/lib/constants.ts ───────────────────────────
  const constantsPath = join(__dirname, "../frontend/src/lib/constants.ts");
  try {
    const before = readFileSync(constantsPath, "utf8");
    const after  = before.replace(
      /export const GAME2048_ADDRESS = "0x[0-9a-fA-F]+" as `0x\$\{string\}`;/,
      `export const GAME2048_ADDRESS = "${GAME_ADDRESS}" as \`0x\${string}\`;`,
    );
    if (before !== after) {
      writeFileSync(constantsPath, after, "utf8");
      console.log("\n  ✓ Updated frontend/src/lib/constants.ts with", GAME_ADDRESS);
    } else {
      console.log("\n  ⚠ Could not auto-patch constants.ts — update GAME2048_ADDRESS manually.");
    }
  } catch {
    console.log("\n  ⚠ Could not read constants.ts — update GAME2048_ADDRESS manually.");
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  All done! Start the frontend and connect your wallet.");
  console.log("  cd frontend && npm run dev");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
