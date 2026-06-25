// Roll the proxy implementation back to the pre-V5 implementation.
//
// The V5 upgrade used a storage layout that does not match the deployed
// contract (the repo source had diverged from what was live), so the V5 impl
// misreads the proxy's storage. A UUPS upgrade never changes stored bytes, so
// re-pointing the implementation restores correct reads. This calls
// upgradeToAndCall(prevImpl, "0x") and then prints key state to confirm the
// data is intact.
//
//   npx hardhat run scripts/rollbackV5.ts --network celo

import { network } from "hardhat";

const PROXY = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6" as `0x${string}`;
const PREV_IMPL = "0x6b730fbfe0c7bbc8b308c9963d2ecec4064910dd" as `0x${string}`;
const IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as `0x${string}`;
const PLAYER = "0xcb6f72152DB12546b21ef0dD5F614Ca532531838" as `0x${string}`;

async function implOf(publicClient: any): Promise<string> {
  const raw = await publicClient.getStorageAt({ address: PROXY, slot: IMPL_SLOT });
  return "0x" + (raw ?? "").slice(-40);
}

async function main() {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [deployer] = await viem.getWalletClients();
  const game = await viem.getContractAt("Game2048", PROXY);

  console.log("\n⏪ Rolling back proxy implementation");
  console.log("   Operator:", deployer.account.address);

  const before = await implOf(publicClient);
  console.log("   Current impl:", before);
  console.log("   Target  impl:", PREV_IMPL);

  if (before.toLowerCase() === PREV_IMPL.toLowerCase()) {
    console.log("\n   ✓ Already on the target implementation — nothing to do.");
  } else {
    const tx = await game.write.upgradeToAndCall([PREV_IMPL, "0x"]);
    console.log(`\n🚀 upgradeToAndCall tx: ${tx}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log(`   ✓ Confirmed in block ${receipt.blockNumber}`);
  }

  console.log("\n   Implementation now:", await implOf(publicClient));

  // Verify the player's state reads sanely again (these were garbage under V5).
  console.log("\n📊 State for", PLAYER, "(should look correct again):");
  console.log("   xp:               ", (await game.read.xp([PLAYER])).toString());
  console.log("   username:         ", await game.read.usernames([PLAYER]));
  console.log("   bestScore:        ", (await game.read.bestScore([PLAYER])).toString());
  console.log("   streakCount:      ", (await game.read.streakCount([PLAYER])).toString());
  console.log("   lastPlayTimestamp:", (await game.read.lastPlayTimestamp([PLAYER])).toString());
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
